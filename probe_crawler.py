import requests
import json
import re
from datetime import datetime

# Lấy ID của một quán ngẫu nhiên (ví dụ Toàn Tâm Trái Cây)
res_id = "1163155" 

FOODY_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "vi-VN,vi;q=0.9",
    "x-requested-with": "XMLHttpRequest",
    "X-Foody-Api-Version": "1",
    "X-Foody-Client-Type": "1",
    "X-Foody-App-Type": "1004"
}

def parse_foody_date(date_str: str) -> str:
    """
    Parse chuỗi ngày tháng của Foody, ví dụ: '/Date(1629864000000)/' 
    trở thành chuỗi ISO (YYYY-MM-DD HH:MM:SS) để test.
    """
    if not date_str:
        return str(datetime.now())
    
    # Dùng regex để bóc tách timestamp
    match = re.search(r'/Date\((\d+)\)/', date_str)
    if match:
        timestamp_ms = int(match.group(1))
        # Foody trả về milliseconds, chuyển sang seconds
        dt = datetime.fromtimestamp(timestamp_ms / 1000.0)
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    
    # Nếu không phải định dạng trên, thử parse iso format
    try:
        dt = datetime.fromisoformat(date_str)
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except:
        return str(datetime.now())

def probe_menu():
    print(f"\n--- THỬ CÀO MENU CHO ID {res_id} ---")
    menu_url = f"https://www.foody.vn/__get/Delivery/GetDeliveryMenu?ResId={res_id}"
    try:
        resp = requests.get(menu_url, headers=FOODY_HEADERS, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            items = data.get("Items", [])
            print(f"Tổng số danh mục món ăn: {len(items)}")
            if len(items) > 0:
                first_cat = items[0]
                first_dish = first_cat.get("Dishes", [])[0] if first_cat.get("Dishes") else None
                print("Tên món ăn mẫu:", first_dish.get("Name") if first_dish else "Trống")
                print("Giá mẫu:", first_dish.get("Price", {}).get("Value") if isinstance(first_dish.get("Price"), dict) else first_dish.get("Price"))
        else:
            print("Status Code lỗi:", resp.status_code)
            print("Response:", resp.text[:200])
    except Exception as e:
        print("Lỗi cào menu:", e)

def probe_reviews():
    print(f"\n--- THỬ CÀO REVIEWS CHO ID {res_id} ---")
    review_url = f"https://www.foody.vn/__get/Review/ResLoadMore?ResId={res_id}&LastId=&Count=2&Type=1"
    try:
        resp = requests.get(review_url, headers=FOODY_HEADERS, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            items = data.get("Items", [])
            print(f"Số lượng review lấy được: {len(items)}")
            if len(items) > 0:
                rev = items[0]
                created_date_raw = rev.get("CreatedDate", "")
                print(f"Chuỗi Date gốc từ Foody: {created_date_raw}")
                print(f"Date sau khi parse: {parse_foody_date(created_date_raw)}")
                print(f"Người dùng: {rev.get('Owner', {}).get('DisplayName')}")
                print(f"Nội dung: {rev.get('Description', '')[:50]}...")
        else:
            print("Status Code lỗi:", resp.status_code)
            print("Response:", resp.text[:200])
    except Exception as e:
        print("Lỗi cào review:", e)

if __name__ == "__main__":
    probe_menu()
    probe_reviews()
