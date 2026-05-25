"""PDF 导出模块 - 生成包含原文和译文的 PDF 文档"""
import glob
import os
import platform
import tempfile
from typing import Dict

from fpdf import FPDF


def _find_chinese_font() -> str:
    """查找系统可用的中文字体"""
    system = platform.system()

    if system == "Darwin":  # macOS
        patterns = [
            "/System/Library/AssetsV2/**/STHEITI*",
            "/System/Library/AssetsV2/**/PingFang*",
            "/System/Library/Fonts/STHeiti*",
            "/System/Library/Fonts/PingFang*",
        ]
        for pattern in patterns:
            matches = glob.glob(pattern, recursive=True)
            if matches:
                return matches[0]

    elif system == "Windows":
        windows_dir = os.environ.get("WINDIR", "C:\\Windows")
        candidates = [
            os.path.join(windows_dir, "Fonts", "msyh.ttc"),       # 微软雅黑
            os.path.join(windows_dir, "Fonts", "simsun.ttc"),     # 宋体
            os.path.join(windows_dir, "Fonts", "simhei.ttf"),     # 黑体
        ]
        for path in candidates:
            if os.path.exists(path):
                return path

    else:  # Linux
        patterns = [
            "/usr/share/fonts/**/NotoSansCJK*",
            "/usr/share/fonts/**/wqy-*",
            "/usr/share/fonts/**/*CJK*",
        ]
        for pattern in patterns:
            matches = glob.glob(pattern, recursive=True)
            if matches:
                return matches[0]

    # 最后的备选：使用 Helvetica（不支持中文，但不会崩溃）
    return ""


def generate_translated_pdf(
    original_path: str,
    translations: Dict[int, str],
    output_path: str,
) -> str:
    """
    生成包含原文和译文的 PDF
    - original_path: 原始 PDF 路径（用于获取文件名）
    - translations: {paragraph_id: translated_text}
    - output_path: 输出 PDF 路径
    """
    font_path = _find_chinese_font()
    has_cjk = bool(font_path)

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)

    # 注册中文字体
    if has_cjk:
        pdf.add_font("CJK", "", font_path)
        font_name = "CJK"
    else:
        font_name = "Helvetica"

    # 从原始路径提取基本信息
    base_name = os.path.splitext(os.path.basename(original_path))[0]

    # 解析原始 PDF 获取段落
    from pdf_parser import parse_pdf
    pdf_data = parse_pdf(original_path)

    # 收集所有段落
    all_paras = []
    for page in pdf_data["pages"]:
        for para in page["paragraphs"]:
            all_paras.append({
                "id": para["id"],
                "text": para["text"],
                "page_num": page["page_num"],
            })

    # ===== 生成封面 =====
    pdf.add_page()
    pdf.set_font(font_name, "", 20) if has_cjk else pdf.set_font(font_name, "", 16)
    pdf.cell(0, 20, "", new_x="LMARGIN", new_y="NEXT")

    if has_cjk:
        pdf.set_font(font_name, "", 24)
        pdf.cell(0, 20, "PDF 翻译文档", new_x="LMARGIN", new_y="NEXT", align="C")
        pdf.set_font(font_name, "", 12)
        pdf.cell(0, 10, f"原文: {base_name}", new_x="LMARGIN", new_y="NEXT", align="C")
        pdf.cell(0, 10, f"总段落数: {len(all_paras)}", new_x="LMARGIN", new_y="NEXT", align="C")
        from datetime import datetime
        pdf.cell(0, 10, f"生成日期: {datetime.now().strftime('%Y-%m-%d %H:%M')}", new_x="LMARGIN", new_y="NEXT", align="C")
    else:
        pdf.cell(0, 10, f"Translation of: {base_name}", new_x="LMARGIN", new_y="NEXT", align="C")
        pdf.cell(0, 10, f"Total paragraphs: {len(all_paras)}", new_x="LMARGIN", new_y="NEXT", align="C")

    # ===== 正文 =====
    for para in all_paras:
        # 检查是否需要换页（剩余空间不足）
        if pdf.get_y() > 250:
            pdf.add_page()

        translated = translations.get(para["id"], "")
        para_num = para["id"] + 1
        page_ref = para["page_num"]

        if has_cjk:
            # 段落编号
            pdf.set_font(font_name, "", 9)
            pdf.set_text_color(150, 150, 150)
            pdf.cell(0, 6, f"#{para_num}  (第 {page_ref} 页)", new_x="LMARGIN", new_y="NEXT")

            # 原文
            pdf.set_font(font_name, "", 9)
            pdf.set_text_color(80, 80, 80)
            pdf.multi_cell(0, 5, para["text"])

            # 分隔线
            pdf.set_draw_color(220, 220, 220)
            pdf.line(pdf.get_x(), pdf.get_y() + 1, pdf.get_x() + 170, pdf.get_y() + 1)
            pdf.ln(3)

            # 译文
            if translated:
                pdf.set_font(font_name, "", 10)
                pdf.set_text_color(30, 30, 30)
                pdf.multi_cell(0, 6, translated)
            else:
                pdf.set_font(font_name, "", 9)
                pdf.set_text_color(200, 200, 200)
                pdf.cell(0, 6, "[未翻译]", new_x="LMARGIN", new_y="NEXT")

            pdf.ln(4)
        else:
            # 无中文字体时，只输出英文原文
            pdf.set_font(font_name, "", 8)
            pdf.set_text_color(80, 80, 80)
            pdf.multi_cell(0, 4, f"#{para_num}: {para['text']}")
            pdf.ln(2)

    pdf.output(output_path)
    return output_path