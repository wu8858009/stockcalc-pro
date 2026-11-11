"""從電腦版 stock_app.py 產生網頁版的文字內容（說明書、滑鼠提示），兩邊說法一致。
用法：python gen_content.py  → 寫出 ../js/content.js"""
import json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(here, "..", ".."))
import stock_app as m  # noqa: E402

out = dict(
    VERSION=m.VERSION, APP_NAME=m.APP_NAME, EDITION=m.EDITION,
    HELP_SECTIONS=[list(x) for x in m.HELP_SECTIONS],
    NAV_TIPS=m.NAV_TIPS, CARD_TIPS=m.CARD_TIPS, WIDGET_TIPS=m.WIDGET_TIPS, HEADER_TIPS=m.HEADER_TIPS,
    FORM_TIPS=m.FORM_TIPS, COMBO_TIPS=m.COMBO_TIPS, PRICE_SOURCES=m.PRICE_SOURCES,
    PAGE_KEYS=[list(x) for x in m.MainWindow.PAGE_KEYS],
)
path = os.path.join(here, "..", "js", "content.js")
with open(path, "w", encoding="utf-8") as f:
    f.write("/* 自動產生：python tools/gen_content.py（來源：電腦版 stock_app.py），請勿手動修改 */\n")
    f.write("window.CONTENT = " + json.dumps(out, ensure_ascii=False, indent=1) + ";\n")
print("寫出", path, os.path.getsize(path), "bytes")
