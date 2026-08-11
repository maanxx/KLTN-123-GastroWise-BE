"""
Crawler ShopeeFood dùng Thuần Selenium 4 (Không dùng selenium-wire).

Sử dụng Chrome DevTools Protocol (CDP) để đánh chặn Network Request.
Cách này khắc phục triệt để lỗi SSL / X509 / ERR_CONNECTION_CLOSED 
do thư viện selenium-wire quá cũ không tương thích Python 3.13.
"""

import json
import time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from pymongo import MongoClient

URL_CONFIGS = [
    {"url": "https://shopeefood.vn/ho-chi-minh/danh-sach-dia-diem-giao-tan-noi", "tags": "Món Việt, Ăn vặt"},
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-food-giao-tan-noi", "tags": "Món Việt"},
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-drink-giao-tan-noi", "tags": "Giải khát, Cafe"},
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-vegetarian-giao-tan-noi", "tags": "Chay, Món chay"},
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-soup-based-giao-tan-noi", "tags": "Món Việt, Món nước"},
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-desserts-giao-tan-noi", "tags": "Tráng miệng, Ăn vặt"},
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-hotpot-giao-tan-noi", "tags": "Món Việt, Lẩu"},
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-pizza-pasta-burger-giao-tan-noi", "tags": "Món Âu, Đồ ăn nhanh"},
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-sushi-giao-tan-noi", "tags": "Món Á, Nhật Bản"},
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-rice-giao-tan-noi", "tags": "Món Việt, Cơm"},
]

MAX_SCROLLS_PER_PAGE = 80 # Tăng số lần cuộn để cào nhiều dữ liệu hơn (Ước tính khoảng 800 - 1000 quán)

def run_crawler():
    print("🔄 Đang kết nối tới MongoDB...")
    try:
        client = MongoClient("mongodb://localhost:27017/")
        db = client["gastrowise"]
        restaurants_collection = db["restaurants"]
        print("✅ Kết nối Database thành công!")
    except Exception as e:
        print(f"❌ Lỗi kết nối MongoDB: {e}")
        return

    print("🕷️ Khởi động Chrome (Thuần Selenium CDP)...")
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument(
        "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    
    # Kích hoạt bắt Log Network của Chrome (thay thế hoàn toàn selenium-wire)
    options.set_capability("goog:loggingPrefs", {"performance": "ALL"})

    driver = webdriver.Chrome(options=options)
    
    # Bật Network domain trong CDP
    driver.execute_cdp_cmd('Network.enable', {})

    scraped_by_id = {}

    try:
        for idx, config in enumerate(URL_CONFIGS):
            url = config["url"]
            current_tags = config["tags"]
            print(f"\n🌐 Đang xử lý danh mục {idx + 1}/{len(URL_CONFIGS)}: {url}")

            driver.get(url)
            time.sleep(4)

            # Xóa sạch log cũ trước khi cuộn
            driver.get_log("performance")

            # Cuộn trang để trigger lazy-load API
            for i in range(MAX_SCROLLS_PER_PAGE):
                driver.execute_script("window.scrollBy(0, 800);")
                time.sleep(1.2)

            # Quét Network Logs để hứng API get_infos
            logs = driver.get_log("performance")
            api_count = 0
            
            for entry in logs:
                try:
                    log_msg = json.loads(entry["message"])["message"]
                    if log_msg["method"] == "Network.responseReceived":
                        resp_url = log_msg["params"]["response"]["url"]
                        
                        if "get_infos" in resp_url and log_msg["params"]["response"]["status"] == 200:
                            api_count += 1
                            req_id = log_msg["params"]["requestId"]
                            
                            # Lấy nội dung JSON trả về
                            body_data = driver.execute_cdp_cmd("Network.getResponseBody", {"requestId": req_id})
                            body_str = body_data.get("body")
                            
                            if body_str:
                                data = json.loads(body_str)
                                infos = data.get("reply", {}).get("delivery_infos", [])
                                for item in infos:
                                    rid = item.get("restaurant_id")
                                    if rid is None or rid in scraped_by_id:
                                        continue

                                    rating = item.get("rating", {}) or {}
                                    position = item.get("position", {}) or {}
                                    phones = item.get("phones", []) or []
                                    photos = item.get("photos", []) or []
                                    photo_url = photos[-1]["value"] if photos else None

                                    scraped_by_id[rid] = {
                                        "restaurantId": rid,
                                        "tenQuan": item.get("name"),
                                        "diaChi": item.get("address"),
                                        "avatarUrl": photo_url,
                                        "diemTrungBinh": rating.get("avg"),
                                        "reviewsCount": rating.get("total_review"),
                                        "tags": current_tags,
                                        "categories": item.get("categories", []),
                                        "cuisines": item.get("cuisines", []),
                                        "lat": position.get("latitude"),
                                        "lon": position.get("longitude"),
                                        "phone": phones[0] if phones else None,
                                        "url": item.get("url"),
                                        "isOpen": item.get("is_open"),
                                    }
                except Exception:
                    pass

            print(f"   📡 Bắt được {api_count} lượt gọi get_infos ở danh mục này.")
            print(f"   📊 Tổng số quán duy nhất đã gom được: {len(scraped_by_id)}")

    finally:
        driver.quit()

    scraped_data = list(scraped_by_id.values())

    if scraped_data:
        print(f"\n🎉 THÀNH CÔNG! Gom được {len(scraped_data)} quán ăn dữ liệu THẬT (API Intercept)!")
        print("💾 Đang ghi vào MongoDB...")
        restaurants_collection.delete_many({})
        restaurants_collection.insert_many(scraped_data)
        print("✅ XONG! Dữ liệu thật đã được lưu vào Database.")
    else:
        print("❌ Không thu được dữ liệu nào.")

if __name__ == "__main__":
    run_crawler()