"""翻译和聊天模块 - 调用 DeepSeek/OpenAI 兼容 API"""
import os
from typing import Any, Dict, Generator, List, Optional

from openai import OpenAI


def _get_client() -> OpenAI:
    return OpenAI(
        api_key=os.getenv("LLM_API_KEY", ""),
        base_url=os.getenv("LLM_BASE_URL", "https://api.deepseek.com/v1"),
    )


def _get_model() -> str:
    return os.getenv("LLM_MODEL", "deepseek-chat")


def _get_temperature() -> float:
    return float(os.getenv("LLM_TEMPERATURE", "0.3"))


def translate_text(text: str, source_lang: str = "英文", target_lang: str = "中文") -> str:
    """翻译文本段落"""
    client = _get_client()
    response = client.chat.completions.create(
        model=_get_model(),
        messages=[
            {
                "role": "system",
                "content": (
                    f"你是一个专业医学翻译。请将以下{source_lang}文本翻译成{target_lang}。\n"
                    "要求：\n"
                    "1. 保持专业术语的准确性\n"
                    "2. 保持原文的学术风格\n"
                    "3. 数字、统计值、P值等精确保留\n"
                    "4. 只返回翻译结果，不要添加任何解释或注释"
                ),
            },
            {"role": "user", "content": text},
        ],
        temperature=_get_temperature(),
    )
    return response.choices[0].message.content or ""


def translate_page_by_image(
    page_image_base64: str,
    source_lang: str = "英文",
    target_lang: str = "中文",
) -> str:
    """
    将整页截图发送给多模态大模型进行翻译。
    大模型直接从图片中识别文字并翻译成中文，无需前端解析PDF文本。
    """
    client = _get_client()

    response = client.chat.completions.create(
        model=_get_model(),
        messages=[
            {
                "role": "system",
                "content": (
                    f"你是一个专业医学翻译。请将图片中的{source_lang}医学文献内容完整翻译成{target_lang}。\n\n"
                    "阅读顺序要求：\n"
                    "1. 如果是双栏排版，先完整读完左栏全部内容，再读右栏内容\n"
                    "2. 单栏排版直接从上到下阅读\n"
                    '3. 标题跨栏的（如“TABLE 1”横跨左右两栏），先输出标题，再按左栏→右栏输出表格内容\n\n'
                    "翻译要求：\n"
                    "1. 完整翻译图片中所有文字内容，不要遗漏任何段落、表格、脚注\n"
                    "2. 保持专业术语的准确性，药物名、医学术语使用标准译名\n"
                    "3. 数字、统计值、P值、置信区间等精确保留\n"
                    "4. 保持原文的段落结构\n"
                    "5. 表格内容以 Markdown 表格格式呈现，保留行列关系\n"
                    "6. 标题使用 Markdown 标题格式（##）\n"
                    "7. 只返回翻译后的内容，不要添加任何解释、注释或额外说明\n"
                    "8. 不要出现'图片'、'截图'等词，直接给出翻译结果"
                ),
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": f"请完整翻译这张图片中所有的{source_lang}医学内容为{target_lang}，保持Markdown格式：",
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{page_image_base64}",
                        },
                    },
                ],
            },
        ],
        temperature=_get_temperature(),
    )
    return response.choices[0].message.content or ""


def translate_page_markdown(
    markdown_text: str,
    source_lang: str = "英文",
    target_lang: str = "中文",
) -> str:
    """
    将 Markdown 格式的页面内容发送给大模型翻译，要求保持 Markdown 结构格式不变。
    适合处理带标题、列表、表格结构的医学文献。
    """
    client = _get_client()

    response = client.chat.completions.create(
        model=_get_model(),
        messages=[
            {
                "role": "system",
                "content": (
                    f"你是一个专业医学翻译。请将以下{source_lang}医学文献翻译成{target_lang}。\n\n"
                    "内容以 Markdown 格式呈现，请严格遵守以下要求：\n"
                    "1. 保持原有的 Markdown 格式结构不变（标题层级、列表、段落分隔等）\n"
                    "2. 保持专业术语的准确性，药物名、医学术语使用标准译名\n"
                    "3. 数字、统计值、P值、置信区间等精确保留\n"
                    "4. 保持原文的学术风格\n"
                    "5. 只返回翻译后的 Markdown 内容，不要添加任何解释或额外说明"
                ),
            },
            {"role": "user", "content": markdown_text},
        ],
        temperature=_get_temperature(),
    )
    return response.choices[0].message.content or ""


def translate_page(
    paragraphs: List[Dict[str, Any]],
    source_lang: str = "英文",
    target_lang: str = "中文",
) -> Dict[int, str]:
    """
    翻译整页的所有段落（一次 API 调用），返回 {para_id: translation} 映射。
    各段落用 [ID:N] 标记包裹，让 LLM 保持段落对应关系。
    """
    client = _get_client()

    # 构建带标记的原文
    marked_text = ""
    for p in paragraphs:
        marked_text += f"[ID:{p['id']}]\n{p['text']}\n\n"

    response = client.chat.completions.create(
        model=_get_model(),
        messages=[
            {
                "role": "system",
                "content": (
                    f"你是一个专业医学翻译。请将以下{source_lang}医学文献翻译成{target_lang}。\n\n"
                    "每段前有 [ID:N] 标记，请在翻译结果中也使用相同的标记。\n"
                    "要求：\n"
                    "1. 保持专业术语的准确性\n"
                    "2. 数字、统计值、P值等精确保留\n"
                    "3. 逐段翻译，保持 [ID:N] 标记\n"
                    "4. 只返回翻译结果，不要添加额外解释"
                ),
            },
            {"role": "user", "content": marked_text},
        ],
        temperature=_get_temperature(),
    )

    result_text = response.choices[0].message.content or ""

    # 解析返回结果，提取 {para_id: translation}
    import re
    translations: Dict[int, str] = {}
    pattern = re.compile(r'\[ID:(\d+)\]\s*(.*?)(?=\n\[ID:\d+\]|\Z)', re.DOTALL)
    for match in pattern.finditer(result_text):
        para_id = int(match.group(1))
        trans_text = match.group(2).strip()
        if trans_text:
            translations[para_id] = trans_text

    return translations


def chat_stream(
    messages: List[Dict[str, str]],
    context: Optional[Dict[str, Any]] = None,
    page_image_base64: Optional[str] = None,
) -> Generator[str, None, None]:
    """流式聊天，支持文本和图片理解"""
    client = _get_client()

    # 构建系统提示
    system_prompt = (
        "你是一个医学文献助手，帮助用户理解PDF文档中的内容。\n"
        "回答要求：\n"
        "1. 准确、简洁，使用中文回答\n"
        "2. 对于统计学术语（如HR, CI, P值等）给出解释\n"
        "3. 如果用户询问图表含义，结合页面截图进行详细解读\n"
        "4. 解读表格时，说明表格标题、列名、关键数据和结论\n"
        "5. 解读图片/图表时，描述图表类型、坐标轴、趋势和关键发现\n"
        "6. 如果不确定，请如实说明"
    )

    if context:
        pdf_name = context.get("pdf_name", "")
        if pdf_name:
            system_prompt += f"\n当前文档：{pdf_name}"
        page_num = context.get("page_num", "")
        if page_num:
            system_prompt += f"\n用户当前查看第 {page_num} 页"
        selected_text = context.get("selected_text", "")
        if selected_text:
            system_prompt += f"\n用户选中的文本：\n{selected_text[:500]}"

    full_messages = [{"role": "system", "content": system_prompt}]

    # 如果有页面截图，将最后一条用户消息转为包含图片的多模态消息
    has_image = bool(page_image_base64)

    for i, msg in enumerate(messages):
        is_last_user = (i == len(messages) - 1 and msg["role"] == "user")

        if is_last_user and has_image:
            # 将最后一条用户消息转为多模态（文本 + 图片）
            full_messages.append({
                "role": "user",
                "content": [
                    {"type": "text", "text": msg["content"]},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{page_image_base64}",
                        },
                    },
                ],
            })
        else:
            full_messages.append(msg)

    try:
        response = client.chat.completions.create(
            model=_get_model(),
            messages=full_messages,
            temperature=_get_temperature(),
            stream=True,
        )

        for chunk in response:
            content = chunk.choices[0].delta.content
            if content:
                yield content
    except Exception as e:
        yield f"\n\n[错误] {str(e)}"