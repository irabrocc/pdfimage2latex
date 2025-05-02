import fitz
import cv2
import numpy as np
import os
import argparse

def get_text_horizontal_range(page):
    """Get the horizontal text range of the page (left/right boundaries)"""
    blocks = page.get_text("blocks")
    left = float('inf')
    right = 0
    
    for block in blocks:
        if block[6] == 0:  # Process only text blocks
            left = min(left, block[0])
            right = max(right, block[2])
    
    return (left, right) if left < right else (0, page.rect.width)

def get_unique_path(output_dir, base_name):
    """Generate unique filename, return full path and filename"""
    counter = 0
    name, ext = os.path.splitext(base_name)
    while True:
        new_name = f"{name}_{counter}{ext}" if counter else f"{base_name}"
        full_path = os.path.join(output_dir, new_name)
        if not os.path.exists(full_path):
            return full_path, new_name
        counter += 1

def compare_pdfs(pdf2_path, pdf1_path, output_dir="images", dpi=200):
    """Core comparison function"""
    generated_files = []
    os.makedirs(output_dir, exist_ok=True)
    
    with fitz.open(pdf1_path) as pdf1, fitz.open(pdf2_path) as pdf2:
        for page_num in range(max(len(pdf1), len(pdf2))):
            if page_num >= len(pdf1) or page_num >= len(pdf2):
                continue
            
            # Load pages and get text range
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
            
            # Generate cropped screenshot
            clip_rect = fitz.Rect(text_left, 0, text_right, page1.rect.height)
            pix1 = page1.get_pixmap(clip=clip_rect, dpi=dpi)
            pix2 = page2.get_pixmap(clip=clip_rect, dpi=dpi)
            
            # Convert to OpenCV format
            img1 = cv2.cvtColor(
                np.frombuffer(pix1.samples, dtype=np.uint8).reshape(pix1.h, pix1.w, 3),
                cv2.COLOR_RGB2BGR
            )
            img2 = cv2.cvtColor(
                np.frombuffer(pix2.samples, dtype=np.uint8).reshape(pix2.h, pix2.w, 3),
                cv2.COLOR_RGB2BGR
            )
            
            # Unify image dimensions
            if img1.shape != img2.shape:
                img2 = cv2.resize(img2, (img1.shape[1], img1.shape[0]))
            
            # Difference detection process
            diff = cv2.absdiff(img1, img2)
            gray = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
            _, thresh = cv2.threshold(gray, 30, 255, cv2.THRESH_BINARY)
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            if not contours:
                continue
            
            # Calculate diff area boundaries
            all_points = np.vstack([c.reshape(-1,2) for c in contours])
            x_min, y_min = all_points.min(axis=0).astype(int)
            x_max, y_max = all_points.max(axis=0).astype(int)
            
            # Expand upper blank area
            upper_blank = y_min
            for y in range(y_min-1, -1, -1):
                if np.all(img2[y] == 255):  # Detect only PDF2's blank lines
                    upper_blank = y
                else:
                    break
            
            # Find lower content boundary
            lower_bound = y_max
            for y in range(y_max, img2.shape[0]):
                if np.array_equal(img1[y], img2[y]):
                    lower_bound = y
                    break
            else:
                lower_bound = img2.shape[0]
            
            # Save processing
            cropped = img2[upper_blank:lower_bound]
            base_name = f"page_{page_num+1}_diff.png"
            output_path, filename = get_unique_path(output_dir, base_name)  # Modified: Get full path and filename
            cv2.imwrite(output_path, cropped)
            generated_files.append(output_path)
            print(output_path)  # Modified: Maintain consistent output format
    
    return generated_files

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf1", help="Original PDF file path")
    parser.add_argument("pdf2", help="Modified PDF file path")
    parser.add_argument("--output-dir", default="images", help="Output directory (default: images)")
    parser.add_argument("--dpi", type=int, default=200, help="Render DPI (default: 200)")
    args = parser.parse_args()
    
    compare_pdfs(args.pdf1, args.pdf2, args.output_dir, args.dpi)