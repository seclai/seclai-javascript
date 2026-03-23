import json

with open("openapi/seclai.openapi.json") as f:
    spec = json.load(f)

keywords = ["update_solution", "search", "mark_model", "inline_text", "delete_source_export", "post_content", "upload_inline", "dismiss"]
for path in spec["paths"]:
    for method in spec["paths"][path]:
        if method not in ("get", "post", "put", "patch", "delete"):
            continue
        op = spec["paths"][path][method].get("operationId", "")
        if any(k in op.lower() for k in keywords) or "search" in path:
            print(f"{method.upper():7s} {path:70s} {op}")
