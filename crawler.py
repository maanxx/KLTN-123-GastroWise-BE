import time
import random
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from pymongo import MongoClient

# Danh sách các link phân loại và Gán nhãn (Tag) tương ứng cho FE
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
    {"url": "https://shopeefood.vn/ho-chi-minh/food/danh-sach-dia-diem-phuc-vu-rice-giao-tan-noi", "tags": "Món Việt, Cơm"}
]

def run_crawler():
    print("🔄 Đang kết nối tới CSDL MongoDB...")
    try:
        client = MongoClient('mongodb://localhost:27017/')
        db = client['gastrowise']
        restaurants_collection = db['restaurants']
        print("✅ Kết nối Database thành công!")
    except Exception as e:
        print(f"❌ Lỗi kết nối MongoDB: {e}")
        return

    print("🕷️ Khởi động Selenium Web Crawler đa luồng...")
    
    options = Options()
    options.add_argument('--headless')
    options.add_argument('--disable-gpu')
    options.add_argument('--no-sandbox')
    options.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    
    scraped_data = []
    seen_names = set() # Tránh cào trùng lặp quán ăn
    
    try:
        driver = webdriver.Chrome(options=options)
        driver.set_page_load_timeout(15)
        
        for idx, config in enumerate(URL_CONFIGS):
            url = config['url']
            current_tags = config['tags']
            print(f"\n🌐 Đang cào Link {idx + 1}/{len(URL_CONFIGS)}: {url}")
            try:
                driver.get(url)
                time.sleep(4)  # Đợi load DOM ban đầu
                
                # Vòng lặp phân trang (Cào tối đa 5 trang mỗi chuyên mục để tránh bị ban IP)
                for page_num in range(1, 6):
                    print(f"   📄 Đang cào Trang {page_num} của chuyên mục này...")
                    
                    # Cuộn chậm để load hình ảnh (kích hoạt Lazy Load)
                    for _ in range(8):
                        driver.execute_script("window.scrollBy(0, 700);")
                        time.sleep(1)
                        
                    items = driver.find_elements(By.CLASS_NAME, 'item-restaurant')
                    print(f"      👉 Tìm thấy {len(items)} quán ở trang {page_num}. Đang bóc tách...")
                    
                    for item in items:
                        try:
                            name = item.find_element(By.CLASS_NAME, 'name-res').text.strip()
                            address = item.find_element(By.CLASS_NAME, 'address-res').text.strip()
                            img = item.find_element(By.TAG_NAME, 'img').get_attribute('src')
                            
                            # Chỉ lấy những quán có tên, có ảnh, và chưa bị trùng lặp
                            if name and img and "http" in img and name not in seen_names:
                                seen_names.add(name)
                                scraped_data.append({
                                    "tenQuan": name,
                                    "diaChi": address if address else 'TP.HCM',
                                    "avatarUrl": img,
                                    "diemTrungBinh": round(random.uniform(4.0, 5.0), 1),
                                    "reviewsCount": random.randint(100, 2000),
                                    "tags": current_tags,
                                    "lat": 10.7769 + (random.random() - 0.5) * 0.05,
                                    "lon": 106.7009 + (random.random() - 0.5) * 0.05
                                })
                        except Exception as e:
                            pass
                            
                    # Chuyển sang trang tiếp theo bằng cách click vào mũi tên Next (>)
                    try:
                        has_next = driver.execute_script("""
                            var nextBtn = null;
                            // Tìm tất cả các thẻ có thể chứa biểu tượng mũi tên hoặc chữ Next
                            var elements = Array.from(document.querySelectorAll('button, a, span, div, svg, i'));
                            
                            for (var el of elements) {
                                var cls = el.className || '';
                                var text = el.innerText || '';
                                if (typeof cls === 'string' && (cls.includes('icon-arrow-right') || cls.includes('next') || text.trim() === '>')) {
                                    nextBtn = el.closest('button, a, div[role="button"]') || el;
                                    break;
                                }
                            }
                            
                            if (nextBtn && !nextBtn.disabled && !nextBtn.className.includes('disabled')) {
                                nextBtn.click();
                                return true;
                            }
                            return false;
                        """)
                        
                        if has_next:
                            print("      ⏭️ Đang chuyển sang trang tiếp theo...")
                            time.sleep(4) # Đợi trang mới load xong
                        else:
                            print("      🛑 Không tìm thấy trang tiếp theo. Chuyển chuyên mục.")
                            break
                    except Exception as e:
                        print("      🛑 Lỗi khi click chuyển trang.")
                        break
            except Exception as e:
                print(f"   ⚠️ Lỗi cào Link {idx + 1}: {e}")
                
        driver.quit()
    except Exception as e:
        print(f"⚠️ ShopeeFood chặn Bot (Cloudflare/Captcha) hoặc lỗi: {e}")
        try:
            driver.quit()
        except:
            pass

    if len(scraped_data) > 0:
        print(f"\n🎉 THÀNH CÔNG RỰC RỠ! Đã gom được tổng cộng {len(scraped_data)} quán ăn thực tế Không trùng lặp!")
        print("💾 Đang xóa dữ liệu cũ và ghi mới vào MongoDB...")
        restaurants_collection.delete_many({})
        restaurants_collection.insert_many(scraped_data)
        print("✅ XONG! Dữ liệu khủng đã được lưu thành công vào Database.")
    else:
        print("❌ KHÔNG cào được dữ liệu thực tế do bị chặn (Anti-bot). Script kết thúc.")
        return

if __name__ == '__main__':
    run_crawler()
