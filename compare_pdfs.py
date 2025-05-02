import fitz
import cv2
import numpy as np
import os
import argparse

def get_text_horizontal_range(page):
    """获取页面文本的水平范围（左右边界）"""
    blocks = page.get_text("blocks")
    left = float('inf')
    right = 0
    
    for block in blocks:
        if block[6] == 0:  # 只处理文本块
            left = min(left, block[0])
            right = max(right, block[2])
    
    return (left, right) if left < right else (0, page.rect.width)

def get_unique_path(output_dir, base_name):
    """生成唯一文件名，返回完整路径和文件名"""
    counter = 0
    name, ext = os.path.splitext(base_name)
    while True:
        new_name = f"{name}_{counter}{ext}" if counter else f"{base_name}"
        full_path = os.path.join(output_dir, new_name)
        if not os.path.exists(full_path):
            return full_path, new_name
        counter += 1

def compare_pdfs(pdf2_path, pdf1_path, output_dir="images", dpi=200):
    """核心比较函数"""
    generated_files = []
    os.makedirs(output_dir, exist_ok=True)
    
    with fitz.open(pdf1_path) as pdf1, fitz.open(pdf2_path) as pdf2:
        for page_num in range(max(len(pdf1), len(pdf2))):
            if page_num >= len(pdf1) or page_num >= len(pdf2):
                continue

            # 加载页面并获取文本范围
            page1 = pdf1.load_page(page_num)
            page2 = pdf2.load_page(page_num)
            text_left = min(
                get_text_horizontal_range(page1)[0],
                get_text_horizontal_range(page2)[0]
            )
            text_right = max(
                get_text_horizontal_range(page1)[1],
                get_text_horizontal_range(page2)[1]
            )

            # 生成裁剪区域截图
            clip_rect = fitz.Rect(text_left, 0, text_right, page1.rect.height)
            pix1 = page1.get_pixmap(clip=clip_rect, dpi=dpi)
            pix2 = page2.get_pixmap(clip=clip_rect, dpi=dpi)

            # 转换为OpenCV格式
            img1 = cv2.cvtColor(
                np.frombuffer(pix1.samples, dtype=np.uint8).reshape(pix1.h, pix1.w, 3),
                cv2.COLOR_RGB2BGR
            )
            img2 = cv2.cvtColor(
                np.frombuffer(pix2.samples, dtype=np.uint8).reshape(pix2.h, pix2.w, 3),
                cv2.COLOR_RGB2BGR
            )
            
            # 统一图像尺寸
            if img1.shape != img2.shape:
                img2 = cv2.resize(img2, (img1.shape[1], img1.shape[0]))

            # 差异检测流程
            diff = cv2.absdiff(img1, img2)
            gray = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
            _, thresh = cv2.threshold(gray, 30, 255, cv2.THRESH_BINARY)
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            if not contours:
                continue

            # 计算差异区域边界
            all_points = np.vstack([c.reshape(-1,2) for c in contours])
            x_min, y_min = all_points.min(axis=0).astype(int)
            x_max, y_max = all_points.max(axis=0).astype(int)

            # 向上扩展空白区域
            upper_blank = y_min
            for y in range(y_min-1, -1, -1):
                if np.all(img2[y] == 255):  # 只检测PDF2的空白行
                    upper_blank = y
                else:
                    break

            # 向下查找相同内容边界
            lower_bound = y_max
            for y in range(y_max, img2.shape[0]):
                if np.array_equal(img1[y], img2[y]):
                    lower_bound = y
                    break
            else:
                lower_bound = img2.shape[0]

            # 保存处理
            cropped = img2[upper_blank:lower_bound]
            base_name = f"page_{page_num+1}_diff.png"
            output_path, filename = get_unique_path(output_dir, base_name)  # 修改点：获取完整路径和文件名
            cv2.imwrite(output_path, cropped)
            generated_files.append(output_path)
            print(output_path)  # 修改点：保持与第一版一致的输出格式

    return generated_files

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf1", help="原始PDF文件路径")
    parser.add_argument("pdf2", help="修改后的PDF文件路径")
    parser.add_argument("--output-dir", default="images", help="输出目录（默认：images）")
    parser.add_argument("--dpi", type=int, default=200, help="渲染DPI（默认：200）")
    args = parser.parse_args()
    
    compare_pdfs(args.pdf1, args.pdf2, args.output_dir, args.dpi)