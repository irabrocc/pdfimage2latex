import fitz
import cv2
import numpy as np
import os
import sys
import argparse

def get_text_horizontal_range(page):
    """获取文本的水平范围（左右边界）"""
    blocks = page.get_text("blocks")
    left = float('inf')
    right = 0
    
    for block in blocks:
        if block[6] == 0:  # 仅处理文本块
            left = min(left, block[0])
            right = max(right, block[2])
    
    return (left, right) if left < right else (0, page.rect.width)

def get_nearest_text_bottom(page, diff_y):
    """找到差异区域上方最近的文本底部（PDF坐标系）"""
    blocks = page.get_text("blocks")
    candidates = []
    
    for block in blocks:
        if block[6] == 0 and block[3] < diff_y:  # 只考虑上方的文本块
            candidates.append(block[3])
    
    return max(candidates) if candidates else page.rect.y1

def crop_bottom_white_space(img_bgr):
    """裁剪图像底部空白区域（BGR格式）"""
    h, w = img_bgr.shape[:2]
    bottom = h
    
    # 从底部向上扫描，找到第一个非全白的行
    for i in reversed(range(h)):
        if not np.all(img_bgr[i] == 255):
            bottom = i + 1
            break
    
    return img_bgr[:bottom] if bottom > 0 else img_bgr

def get_unique_path(output_dir, base_name):
    counter = 0
    name, ext = os.path.splitext(base_name)
    while True:
        new_name = f"{name}_{counter}{ext}" if counter else f"{base_name}"
        full_path = os.path.join(output_dir, new_name)
        if not os.path.exists(full_path):
            return full_path, new_name
        counter += 1

def compare_pdfs(pdf1_path, pdf2_path, output_dir="images", dpi=200):
    generated_files = []
    with fitz.open(pdf1_path) as pdf1, fitz.open(pdf2_path) as pdf2:
        for page_num in range(max(len(pdf1), len(pdf2))):
            if page_num >= len(pdf1) or page_num >= len(pdf2):
                continue

            page1 = pdf1.load_page(page_num)
            page2 = pdf2.load_page(page_num)
            
            # 获取文本水平范围
            text_left1, text_right1 = get_text_horizontal_range(page1)
            text_left2, text_right2 = get_text_horizontal_range(page2)
            final_left = min(text_left1, text_left2)
            final_right = max(text_right1, text_right2)
            
            # 检测差异区域
            pix1 = page1.get_pixmap(dpi=dpi)
            pix2 = page2.get_pixmap(dpi=dpi)
            
            img1 = cv2.cvtColor(np.frombuffer(pix1.samples, dtype=np.uint8).reshape(pix1.h, pix1.w, 3), 
                              cv2.COLOR_RGB2BGR)
            img2 = cv2.cvtColor(np.frombuffer(pix2.samples, dtype=np.uint8).reshape(pix2.h, pix2.w, 3), 
                              cv2.COLOR_RGB2BGR)

            if img1.shape != img2.shape:
                img2 = cv2.resize(img2, (img1.shape[1], img1.shape[0]))

            diff = cv2.absdiff(img1, img2)
            gray = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
            _, thresh = cv2.threshold(gray, 30, 255, cv2.THRESH_BINARY)
            
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not contours:
                continue

            all_points = np.vstack([c.reshape(-1,2) for c in contours])
            y_min_px, x_min_px = all_points.min(0)
            y_max_px, x_max_px = all_points.max(0)

            page_height = page1.rect.height
            scale = page_height / pix1.height
            diff_top_pdf = page_height - y_max_px * scale
            diff_bottom_pdf = page_height - y_min_px * scale
            
            # 确定垂直范围
            top_y = get_nearest_text_bottom(page1, diff_top_pdf)
            bottom_y = diff_bottom_pdf
            
            # 生成截图
            clip_rect = fitz.Rect(
                final_left,
                top_y,
                final_right,
                bottom_y
            ).intersect(page1.rect)
            
            output_pix = page1.get_pixmap(
                clip=clip_rect,
                dpi=dpi,
                colorspace="rgb"
            )
            
            # 转换为OpenCV格式并进行裁剪
            img_array = np.frombuffer(output_pix.samples, dtype=np.uint8).reshape(
                output_pix.h, output_pix.w, 3)
            img_bgr = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
            cropped_img = crop_bottom_white_space(img_bgr)
            # ... [保留原有比较逻辑，修改保存部分]
            output_path, filename = get_unique_path(output_dir, f"page_{page_num+1}_diff.png")
            cv2.imwrite(output_path, cropped_img)
            generated_files.append(output_path)
            print(output_path)  # 输出路径供插件捕获
    return generated_files

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf1")
    parser.add_argument("pdf2")
    parser.add_argument("--output-dir", default="images")
    parser.add_argument("--dpi", type=int, default=200)
    args = parser.parse_args()
    
    os.makedirs(args.output_dir, exist_ok=True)
    compare_pdfs(args.pdf1, args.pdf2, args.output_dir, args.dpi)