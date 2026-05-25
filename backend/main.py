"""FastAPI 主应用 - API 路由和服务入口"""
import hashlib
import json
import os
import sys
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv, set_key
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ─── 翻译缓存 ───
CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "translations_cache")

def _get_cache_path(pdf_path: str) -> str:
    """根据 PDF 路径生成唯一的缓存文件路径"""
    os.makedirs(CACHE_DIR, exist_ok=True)
    name = os.path.splitext(os.path.basename(pdf_path))[0]
    path_hash = hashlib.md5(pdf_path.encode()).hexdigest()[:8]
    # 清理文件名中的特殊字符
    safe_name = "".join(c if c.isalnum() or c in " _-" else "_" for c in name)
    return os.path.join(CACHE_DIR, f"{safe_name}_{path_hash}.json")

def _load_cached_translations(pdf_path: str) -> Dict[str, str]:
    """加载 PDF 的缓存翻译记录"""
    cache_path = _get_cache_path(pdf_path)
    if os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            return json.load(f).get("translations", {})
    return {}

def _save_translation_to_cache(pdf_path: str, page_num: int, translation: str):
    """保存一页的翻译结果到缓存"""
    cache_path = _get_cache_path(pdf_path)
    if os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            cache = json.load(f)
    else:
        cache = {"pdf_path": pdf_path, "translations": {}}

    cache["translations"][str(page_num)] = translation
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)

from pdf_parser import extract_page_image, page_to_markdown, parse_pdf
from translator import chat_stream, translate_page_by_image, translate_page_markdown, translate_text
from export_pdf import generate_translated_pdf
from export_docx import generate_translated_docx

# 加载 .env（从项目根目录）
ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
load_dotenv(ENV_PATH)

app = FastAPI(title="PDF 翻译阅读器")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── 数据模型 ───

class ChatRequest(BaseModel):
    messages: List[Dict[str, str]]
    context: Optional[Dict[str, Any]] = None
    page_image: Optional[str] = None  # base64 编码的页面截图


# ─── API 路由 ───

@app.get("/api/pdf/list")
def list_pdfs():
    """列出项目目录下的所有 PDF 文件"""
    project_dir = os.path.dirname(os.path.dirname(__file__))
    pdfs = []
    for f in os.listdir(project_dir):
        if f.lower().endswith(".pdf"):
            full_path = os.path.join(project_dir, f)
            pdfs.append({"name": f, "path": full_path})
    return {"files": pdfs}


@app.get("/api/pdf/parse")
def parse_pdf_endpoint(path: str = Query(...)):
    """解析 PDF，返回段落和图片信息"""
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="文件不存在")
    try:
        return parse_pdf(path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解析失败: {str(e)}")


@app.get("/api/translations")
def get_translations(path: str = Query(...)):
    """获取 PDF 已缓存的翻译记录（跨会话持久化）"""
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="文件不存在")
    return {"translations": _load_cached_translations(path)}


@app.post("/api/translate")
def translate(body: dict):
    """翻译单段文本"""
    text = body.get("text", "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="文本不能为空")
    try:
        result = translate_text(text)
        return {"translated_text": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"翻译失败: {str(e)}")


@app.post("/api/translate-page")
def translate_whole_page(body: dict):
    """将 PDF 页面截图发给多模态大模型翻译，结果存入缓存"""
    import fitz
    path = body.get("path", "")
    page_num = body.get("page", 1)

    if not path or not os.path.exists(path):
        raise HTTPException(status_code=400, detail="文件不存在")

    # 1. 先查缓存
    cached = _load_cached_translations(path)
    if str(page_num) in cached:
        return {"translations": {str(page_num): cached[str(page_num)]}, "page": page_num, "cached": True}

    # 2. 缓存未命中，截图 → 多模态翻译
    try:
        doc = fitz.open(path)
        if page_num < 1 or page_num > len(doc):
            doc.close()
            raise HTTPException(status_code=404, detail="页面不存在")
        doc.close()

        # 截取页面截图（base64，中等清晰度）
        page_image = extract_page_image(path, page_num - 1, zoom=2.0)
        if not page_image:
            raise HTTPException(status_code=500, detail="页面截图失败")

        result = translate_page_by_image(page_image)

        # 3. 存入缓存
        _save_translation_to_cache(path, page_num, result)

        return {"translations": {str(page_num): result}, "page": page_num, "cached": False}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"页面翻译失败: {str(e)}")


@app.post("/api/chat")
async def chat(body: ChatRequest):
    """聊天接口（SSE 流式返回，支持图片理解）"""
    return StreamingResponse(
        chat_stream(
            messages=body.messages,
            context=body.context,
            page_image_base64=body.page_image,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/pdf/page-image")
def get_page_image(path: str = Query(...), page: int = Query(1)):
    """获取指定页面截图（base64 编码）"""
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="文件不存在")
    try:
        image_b64 = extract_page_image(path, page - 1)
        if image_b64 is None:
            raise HTTPException(status_code=404, detail="页面不存在")
        return {"image": image_b64}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"截图失败: {str(e)}")


@app.get("/api/settings")
def get_settings():
    """获取当前配置"""
    keys = ["PDF_PATH", "LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_TEMPERATURE"]
    settings = {}
    for key in keys:
        settings[key] = os.getenv(key, "")
    return settings


@app.post("/api/settings")
def update_settings(body: dict):
    """更新配置并写入 .env 文件"""
    for key, value in body.items():
        if value is not None and isinstance(value, str):
            set_key(ENV_PATH, key, value)
            os.environ[key] = value
    # 重新加载环境变量
    load_dotenv(ENV_PATH, override=True)
    return {"status": "ok"}


@app.get("/api/pdf/file")
def get_pdf_file(path: str = Query(...)):
    """提供 PDF 文件下载"""
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(path, media_type="application/pdf")


@app.post("/api/translate-all")
def translate_all(body: dict):
    """批量翻译全文所有段落"""
    path = body.get("path", "")
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=400, detail="文件不存在或路径为空")

    try:
        pdf_data = parse_pdf(path)
        translations: Dict[int, str] = {}

        for page in pdf_data["pages"]:
            for para in page["paragraphs"]:
                para_id = para["id"]
                try:
                    result = translate_text(para["text"])
                    translations[para_id] = result
                except Exception as e:
                    translations[para_id] = f"[翻译失败] {str(e)[:50]}"

        return {
            "translations": {str(k): v for k, v in translations.items()},
            "total": len(translations),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"翻译失败: {str(e)}")


@app.post("/api/export-pdf")
def export_pdf(body: dict):
    """导出包含原文和译文的 PDF 文件"""
    path = body.get("path", "")
    translations_raw = body.get("translations", {})

    if not path or not os.path.exists(path):
        raise HTTPException(status_code=400, detail="文件不存在")

    try:
        # 转换 translations 的 key 为 int
        translations = {int(k): v for k, v in translations_raw.items()}

        # 生成输出文件名
        base_name = os.path.splitext(os.path.basename(path))[0]
        output_name = f"{base_name}_翻译.pdf"
        output_dir = os.path.dirname(path) or os.getcwd()
        output_path = os.path.join(output_dir, output_name)

        generate_translated_pdf(path, translations, output_path)

        return FileResponse(
            output_path,
            media_type="application/pdf",
            filename=output_name,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"导出失败: {str(e)}")


@app.post("/api/export-docx")
def export_docx(body: dict):
    """导出翻译结果为 DOCX 文件"""
    path = body.get("path", "")

    if not path or not os.path.exists(path):
        raise HTTPException(status_code=400, detail="文件不存在")

    try:
        translations = _load_cached_translations(path)
        if not translations:
            raise HTTPException(status_code=400, detail="没有找到翻译缓存，请先翻译")

        import fitz
        doc = fitz.open(path)
        total_pages = len(doc)
        doc.close()

        trans_int = {int(k): v for k, v in translations.items()}
        output_path = generate_translated_docx(path, trans_int, total_pages)

        out_name = os.path.basename(output_path)
        return FileResponse(
            output_path,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename=out_name,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"导出 DOCX 失败: {str(e)}")


# 挂载前端静态文件（API 路由优先）
FRONTEND_DIST = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist")
if os.path.isdir(FRONTEND_DIST):
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
    print(f"[启动] 前端静态文件已挂载: {FRONTEND_DIST}", file=sys.stderr)


if __name__ == "__main__":
    import uvicorn
    # 自动寻找可用端口
    port = int(os.environ.get("PORT", 8001))
    print(f"[启动] API 服务: http://localhost:{port}", file=sys.stderr)
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)