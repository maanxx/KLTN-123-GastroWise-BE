"""
Crawler 3 giai đoạn cho ShopeeFood/Foody.vn:

GIAI ĐOẠN 1 (Selenium - trình duyệt thật):
    Duyệt qua các trang danh mục món ăn trên shopeefood.vn, cuộn để load
    thêm quán, và thu thập "slug" (đường dẫn định danh) của từng quán ăn.

GIAI ĐOẠN 2 (requests - không cần trình duyệt):
    Với mỗi slug thu được, lấy dữ liệu chi tiết quán (initData) từ Foody.vn
    bao gồm giờ mở cửa, mức giá, tọa độ, v.v.

GIAI ĐOẠN 3 (requests API - lấy Review thật):
    Dùng RestaurantID lấy từ Giai đoạn 2 để chọc vào API ẩn của Foody
    (ResLoadMore) nhằm cào các review thật của người dùng (tối đa 15 review/quán).

Cài đặt: pip install selenium requests pymongo
"""

import json
import re
import time
from urllib.parse import urlparse
from datetime import datetime
import os

import requests
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from pymongo import MongoClient
from dotenv import load_dotenv

URL_CONFIGS = [
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-food-giao-tan-noi", "tags": "ĐỒ ĂN"},
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-drink-giao-tan-noi", "tags": "ĐỒ UỐNG"},
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-vegetarian-giao-tan-noi", "tags": "ĐỒ CHAY"},
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-cake-bakery-giao-tan-noi", "tags": "BÁNH KEM"},
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-soup-based-giao-tan-noi", "tags": "MÌ PHỞ"},
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-desserts-giao-tan-noi", "tags": "TRÁNG MIỆNG"},
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-hotpot-giao-tan-noi", "tags": "MÓN LẨU"},
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-pizza-pasta-burger-giao-tan-noi", "tags": "PIZZA/BURGER"},
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-sushi-giao-tan-noi", "tags": "SUSHI"},
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-rice-giao-tan-noi", "tags": "CƠM HỘP"}
]

MAX_SCROLLS_PER_PAGE = 15
REQUEST_DELAY_SECONDS = 1.0  

FOODY_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "vi-VN,vi;q=0.9",
    "x-requested-with": "XMLHttpRequest"
}
INIT_DATA_PATTERN = re.compile(r"var\s+initData\s*=\s*(\{.*?\});", re.DOTALL)

# --- GIAI ĐOẠN 1 ---
def extract_slug_from_href(href: str) -> str | None:
    if not href:
        return None
    try:
        path = urlparse(href).path if href.startswith("http") else href
        parts = [p for p in path.split("/") if p]
        if len(parts) >= 2 and parts[0] == "ho-chi-minh":
            slug = parts[1]
            if slug and slug not in ("food", "danh-sach-dia-diem-giao-tan-noi"):
                return slug
    except Exception:
        pass
    return None

def collect_slugs_via_selenium() -> dict:
    print("🕷️ [Giai đoạn 1] Khởi động Chrome để thu thập link quán ăn...")
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument(
        "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    driver = webdriver.Chrome(options=options)
    slug_to_tags = {}

    try:
        for idx, config in enumerate(URL_CONFIGS):
            url = config["url"]
            current_tags = config["tags"]
            print(f"\n🌐 Danh mục {idx + 1}/{len(URL_CONFIGS)}: {url}")
            try:
                driver.get(url)
                time.sleep(3)
                for _ in range(MAX_SCROLLS_PER_PAGE):
                    driver.execute_script("window.scrollBy(0, 800);")
                    time.sleep(1.0)
                anchors = driver.find_elements(By.TAG_NAME, "a")
                found_this_page = 0
                for a in anchors:
                    try:
                        href = a.get_attribute("href")
                    except Exception:
                        continue
                    slug = extract_slug_from_href(href)
                    if slug and slug not in slug_to_tags:
                        slug_to_tags[slug] = current_tags
                        found_this_page += 1
                print(f"   📌 Thu thập được {found_this_page} link mới")
            except Exception as e:
                print(f"   ⚠️ Lỗi khi xử lý danh mục này: {e}")
                continue
    finally:
        driver.quit()
    return slug_to_tags

# --- GIAI ĐOẠN 2 & 3 ---
def format_price(p):
    return f"{int(p):,}đ".replace(",", ".") if p else ""

def fetch_restaurant_detail_and_reviews(slug: str, tags: str) -> tuple:
    url = f"https://www.foody.vn/ho-chi-minh/{slug}"
    try:
        resp = requests.get(url, headers=FOODY_HEADERS, timeout=10)
    except Exception as e:
        return None, []
    if resp.status_code != 200:
        return None, []

    match = INIT_DATA_PATTERN.search(resp.text)
    if not match:
        return None, []
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None, []

    # Format Opening Time
    opening_time_str = ""
    opening_time = data.get("OpeningTime")
    if opening_time and isinstance(opening_time, list) and len(opening_time) > 0:
        op = opening_time[0]
        t_open = op.get("TimeOpen", {})
        t_close = op.get("TimeClose", {})
        if t_open and t_close:
            opening_time_str = f"{t_open.get('Hours',0):02d}:{t_open.get('Minutes',0):02d} - {t_close.get('Hours',0):02d}:{t_close.get('Minutes',0):02d}"

    # Format Price Range
    p_min = data.get("PriceMin")
    p_max = data.get("PriceMax")
    price_range = ""
    if p_min and p_max:
        price_range = f"{format_price(p_min)} - {format_price(p_max)}"
    elif p_min:
        price_range = format_price(p_min)

    cuisines = [c.get("Name") for c in data.get("Cuisines", []) if c.get("Name")]
    restaurant_id = data.get("RestaurantID")
    
    info = {
        "restaurantId": str(restaurant_id) if restaurant_id else None,
        "tenQuan": data.get("Name"),
        "diaChi": data.get("Address"),
        "quan": data.get("District"),
        "khuVuc": data.get("Area"),
        "thanhPho": data.get("City"),
        "diemTrungBinh": data.get("AvgRating"),
        "reviewsCount": data.get("TotalReview"),
        "lat": data.get("Latitude"),
        "lon": data.get("Longtitude"),
        "giaMin": p_min,
        "giaMax": p_max,
        "priceRange": price_range,
        "openingTime": opening_time_str,
        "cuisines": cuisines,
        "tags": tags,
        "slug": slug,
        "urlGoc": data.get("MicrositeUrl") or url,
        "avatarUrl": (data.get("PictureModel") or {}).get("ImageUrl"),
    }

    # GIAI ĐOẠN 3: LẤY REVIEWS THẬT
    reviews = []
    if restaurant_id:
        review_url = f"https://www.foody.vn/__get/Review/ResLoadMore?ResId={restaurant_id}&LastId=&Count=15&Type=1"
        try:
            r_resp = requests.get(review_url, headers=FOODY_HEADERS, timeout=10)
            if r_resp.status_code == 200:
                items = r_resp.json().get("Items", [])
                for item in items:
                    reviews.append({
                        "restaurantId": str(restaurant_id),
                        "userId": str(item.get("Owner", {}).get("Id", "")),
                        "userName": item.get("Owner", {}).get("DisplayName", "Ẩn danh"),
                        "rating": float(item.get("AvgRating", 0)),
                        "comment": item.get("Description", ""),
                        "createdAt": datetime.now(), # Hoặc parse CreatedDate nếu cần
                        "updatedAt": datetime.now()
                    })
        except Exception as e:
            pass 

    return info, reviews


# --- MAIN ---
def run_crawler():
    print("🔄 Đang kết nối tới MongoDB...")
    load_dotenv() # Load variables from .env file
    mongo_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017/")
    try:
        print(f"🔗 Đang dùng chuỗi kết nối: {mongo_uri}")
        client = MongoClient(mongo_uri)
        db = client["gastrowise"]
        restaurants_collection = db["restaurants"]
        reviews_collection = db["reviews"]
        print("✅ Kết nối Database thành công!")
    except Exception as e:
        print(f"❌ Lỗi kết nối MongoDB: {e}")
        return

    # Phase 1
    slug_to_tags = collect_slugs_via_selenium()
    print(f"\n🎯 [Giai đoạn 1] HOÀN TẤT. Tổng số quán tìm được: {len(slug_to_tags)}")

    if not slug_to_tags:
        return

    # Phase 2 & 3
    print(f"\n🕷️ [Giai đoạn 2 & 3] Bắt đầu lấy dữ liệu và Review thật từ Foody.vn...")
    scraped_restaurants = []
    scraped_reviews = []
    total = len(slug_to_tags)

    for i, (slug, tags) in enumerate(slug_to_tags.items(), start=1):
        print(f"   [{i}/{total}] Đang tải: {slug}")
        info, reviews = fetch_restaurant_detail_and_reviews(slug, tags)
        if info and info.get("restaurantId"):
            scraped_restaurants.append(info)
            scraped_reviews.extend(reviews)
        time.sleep(REQUEST_DELAY_SECONDS) 

    print(f"\n🎉 HOÀN TẤT! Lấy được {len(scraped_restaurants)} quán ăn và {len(scraped_reviews)} đánh giá (reviews) thật.")

    if scraped_restaurants:
        print("💾 Đang ghi vào MongoDB...")
        restaurants_collection.delete_many({})
        restaurants_collection.insert_many(scraped_restaurants)
        
        if scraped_reviews:
            reviews_collection.delete_many({})
            reviews_collection.insert_many(scraped_reviews)
            
        print("✅ XONG! Dữ liệu thật đã được lưu vào Database.")
    else:
        print("❌ Không có dữ liệu nào để lưu.")

if __name__ == "__main__":
    run_crawler()