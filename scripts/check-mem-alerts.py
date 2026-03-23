import json

with open("openapi/seclai.openapi.json") as f:
    spec = json.load(f)

paths_of_interest = [
    "/memory_banks/templates",
    "/memory_banks/{memory_bank_id}/agents",
    "/memory_banks/{memory_bank_id}/stats",
    "/memory_banks/{memory_bank_id}/ai-assistant/accept",
    "/alerts/org-preferences",
]

for path in spec["paths"]:
    if path in paths_of_interest or any(p in path for p in ["org-preference", "memory_bank_id}/ai-assistant"]):
        for method in spec["paths"][path]:
            if method not in ("get", "post", "put", "patch", "delete"):
                continue
            op_data = spec["paths"][path][method]
            op = op_data.get("operationId", "")
            resp200 = op_data.get("responses", {}).get("200", {})
            schema = resp200.get("content", {}).get("application/json", {}).get("schema", {})
            ref = schema.get("$ref", "")
            title = schema.get("title", "")
            typ = schema.get("type", "")
            items_ref = schema.get("items", {}).get("$ref", "")
            print(f"{method.upper():7s} {path}")
            print(f"        op: {op}")
            if ref:
                print(f"        ref: {ref}")
            elif items_ref:
                print(f"        array of: {items_ref}")
            elif title:
                print(f"        title={title} type={typ}")
            else:
                print(f"        (no typed schema)")
            print()
