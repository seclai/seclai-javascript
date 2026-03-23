import json

with open("openapi/seclai.openapi.json") as f:
    spec = json.load(f)

targets = [
    "list_alerts", "get_alert", "change_alert_status", "add_alert_comment",
    "subscribe_to_alert", "unsubscribe_from_alert",
    "list_alert_configs", "create_alert_config", "get_alert_config", "update_alert_config",
    "update_organization_alert_preference",
    "list_model_alerts", "get_alert_unread_count", "get_model_recommendations",
    "mark_read", "mark_all_read", "dismiss_all",
    "get_agents_using_memory_bank", "get_memory_bank_stats", "compact_memory_bank",
    "list_memory_bank_templates", "accept_memory_bank",
    "list_evaluation_criteria",
    "search_api_search",
    "ai_assistant_knowledge_base", "ai_assistant_source", "ai_assistant_solution",
    "ai_assistant_memory_bank", "get_ai_assistant_memory_bank",
    "accept_ai_assistant", "accept_ai_memory_bank",
    "replace_content_with_inline_text",
]

for path in spec["paths"]:
    for method in spec["paths"][path]:
        if method not in ("get", "post", "put", "patch", "delete"):
            continue
        op = spec["paths"][path][method].get("operationId", "")
        if any(t in op for t in targets):
            resp200 = spec["paths"][path][method].get("responses", {}).get("200", {})
            schema = resp200.get("content", {}).get("application/json", {}).get("schema", {})
            ref = schema.get("$ref", "")
            title = schema.get("title", "")
            typ = schema.get("type", "")
            items_ref = schema.get("items", {}).get("$ref", "")
            print(f"{method.upper():7s} {path}")
            print(f"        op: {op}")
            if ref:
                print(f"        schema: {ref}")
            elif items_ref:
                print(f"        schema: array of {items_ref}")
            elif title:
                print(f"        schema: title={title} type={typ}")
            elif typ:
                print(f"        schema: type={typ}")
            else:
                resp204 = spec["paths"][path][method].get("responses", {}).get("204", {})
                if resp204:
                    print(f"        schema: 204 (no body)")
                else:
                    print(f"        schema: (none)")
            print()
