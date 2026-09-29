#!/usr/bin/env python3
"""Writes the (synthetic, deterministic) input files for the JSON Explorer skill evals.

Usage: python3 make_fixtures.py <output-dir>

Every value is fake: names, emails, phone numbers and keys are generated from a fixed seed.
Each eval's files go to <output-dir>/<eval-name>/. ground_truth.json records the facts the
graders check.
"""

import json
import os
import random
import sys

FIRST = ["Ada", "Grace", "Alan", "Edsger", "Barbara", "Donald", "Frances", "John", "Radia", "Ken", "Margaret", "Tim"]
LAST = ["Lovelace", "Hopper", "Turing", "Dijkstra", "Liskov", "Knuth", "Allen", "Backus", "Perlman", "Thompson", "Hamilton", "Berners"]
CITIES = [("Paris", "FR"), ("Austin", "US"), ("Pune", "IN"), ("Osaka", "JP"), ("Lagos", "NG"), ("Lima", "PE")]


def token(rng, alphabet, length):
    return "".join(rng.choice(alphabet) for _ in range(length))


ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"


def orders(rng):
    records = []
    statuses = ["paid", "shipped", "delivered", "refunded", "cancelled"]
    for index in range(4000):
        first, last = rng.choice(FIRST), rng.choice(LAST)
        city, country = rng.choice(CITIES)
        items = [{"sku": f"SKU-{rng.randint(1, 300):04d}", "qty": rng.randint(1, 4), "price": f"{rng.randint(300, 20000) / 100:.2f}"} for _ in range(rng.randint(1, 5))]
        record = {
            "id": f"ORD-{100001 + index}",
            "customer": {"name": f"{first} {last}", "email": f"{first.lower()}.{last.lower()}{index}@example.com", "phone": f"+1-555-{rng.randint(1000, 9999)}"},
            "items": items,
            "total": "TOTAL",
            "currency": "USD",
            "status": rng.choice(statuses),
            "shipping": {"city": city, "country": country},
            "payment": {"method": "card", "card_last4": f"{rng.randint(0, 9999):04d}", "token": "tok_" + token(rng, ALNUM, 24)},
            "created_at": f"2026-08-{rng.randint(1, 31):02d}T{rng.randint(0, 23):02d}:{rng.randint(0, 59):02d}:00Z",
        }
        if rng.random() < 0.15:
            record["coupon"] = rng.choice(["SPRING10", "VIP20", "WELCOME5"])
        total = sum(int(round(float(item["price"]) * 100)) * item["qty"] for item in items)
        records.append((record, f"{total / 100:.2f}"))
    return records


def write_orders(directory, rng):
    records = orders(rng)
    export = {"store": "Northwind Outfitters", "generated_at": "2026-09-28T23:00:00Z", "api_key": "sk_live_" + token(rng, ALNUM, 32)}
    parts = [json.dumps(record, indent=2).replace('"TOTAL"', total) for record, total in records]
    text = '{\n"export": ' + json.dumps(export, indent=2) + ',\n"orders": [\n' + ",\n".join(parts) + "\n]\n}\n"
    with open(os.path.join(directory, "orders.json"), "w") as handle:
        handle.write(text)
    statuses = {}
    for record, _ in records:
        statuses[record["status"]] = statuses.get(record["status"], 0) + 1
    return {
        "orders": len(records),
        "statuses": statuses,
        "emails": [record["customer"]["email"] for record, _ in records],
        "phones": [record["customer"]["phone"] for record, _ in records],
        "secrets": [export["api_key"]] + [record["payment"]["token"] for record, _ in records],
    }


def write_diff(directory, rng):
    products = []
    for index in range(1, 301):
        products.append({"id": index, "sku": f"SKU-{index:04d}", "name": f"Product {index}", "price": f"{rng.randint(300, 20000) / 100:.2f}", "stock": rng.randint(1, 80), "updated_at": "2026-09-27T10:00:00Z"})
    before = [dict(product) for product in products]
    after = [dict(product, updated_at="2026-09-28T04:12:00Z") for product in products]
    before[12]["order_ref"] = "REF_BEFORE"
    after[12]["order_ref"] = "REF_AFTER"
    before[41]["price"], after[41]["price"] = "19.99", "24.99"
    before[106]["price"], after[106]["price"] = "5.00", "4.50"
    before[249]["price"], after[249]["price"] = "120.00", "115.00"
    before[76]["stock"], after[76]["stock"] = 14, 0
    del after[198]
    after.append({"id": 301, "sku": "SKU-0301", "name": "Product 301", "price": "42.00", "stock": 12, "updated_at": "2026-09-28T04:12:00Z"})

    def dump(items, generated):
        text = json.dumps({"generated_at": generated, "products": items}, indent=2)
        # Keep prices as JSON numbers written exactly as above (e.g. 5.00), and the 64-bit reference exact.
        for item in items:
            text = text.replace(f'"price": "{item["price"]}"', f'"price": {item["price"]}', 1)
        return text.replace('"REF_BEFORE"', "9007199254740993").replace('"REF_AFTER"', "9007199254740992") + "\n"

    with open(os.path.join(directory, "before.json"), "w") as handle:
        handle.write(dump(before, "2026-09-27T10:00:00Z"))
    with open(os.path.join(directory, "after.json"), "w") as handle:
        handle.write(dump(after, "2026-09-28T04:12:00Z"))
    return {
        "price_changes": {"SKU-0042": ["19.99", "24.99"], "SKU-0107": ["5.00", "4.50"], "SKU-0250": ["120.00", "115.00"]},
        "stock_change": {"SKU-0077": [14, 0]},
        "removed": "SKU-0199",
        "added": "SKU-0301",
        "order_ref": {"sku": "SKU-0013", "before": "9007199254740993", "after": "9007199254740992"},
    }


CONFIG = """// Billing service configuration (edited by hand)
{
  service: 'billing-api',
  "port": 8080,
  "tenant_id": 12345678901234567891,
  "fee_rate": 1.50,
  "retry": { "max": 3, "backoff_ms": 250, },
  "features": ['invoices', 'refunds',],
  "debug": True,
  "fallback": None,
  /* rotated monthly */
  "api_token": "TOKEN"
}
"""


def write_config(directory, rng):
    api_token = "ghp_" + token(rng, ALNUM, 36)
    with open(os.path.join(directory, "config.json"), "w") as handle:
        handle.write(CONFIG.replace("TOKEN", api_token))
    return {
        "keys": ["service", "port", "tenant_id", "fee_rate", "retry", "features", "debug", "fallback", "api_token"],
        "tenant_id": "12345678901234567891",
        "fee_rate": "1.50",
        "api_token": api_token,
        "values": {"service": "billing-api", "port": 8080, "retry": {"max": 3, "backoff_ms": 250}, "features": ["invoices", "refunds"], "debug": True, "fallback": None},
    }


def write_logs(directory, rng):
    errors = [("db timeout", 512), ("payment declined", 301), ("upstream 503", 244), ("cache miss storm", 120), ("invalid token", 57)]
    lines = []
    for message, count in errors:
        lines += [{"level": "error", "msg": message} for _ in range(count)]
    lines += [{"level": "warn", "msg": rng.choice(["slow query", "retrying", "deprecated endpoint"])} for _ in range(3100)]
    total = 60000
    lines += [{"level": "info", "msg": rng.choice(["request served", "cache hit", "job done"])} for _ in range(total - len(lines))]
    rng.shuffle(lines)
    os.makedirs(os.path.join(directory, "logs"), exist_ok=True)
    with open(os.path.join(directory, "logs", "app.jsonl"), "w") as handle:
        for index, line in enumerate(lines):
            first, last = rng.choice(FIRST), rng.choice(LAST)
            record = {"ts": f"2026-09-28T{index % 24:02d}:{index % 60:02d}:{index % 60:02d}Z", "level": line["level"], "msg": line["msg"], "request_id": f"req-{index:06d}", "user": f"{first.lower()}.{last.lower()}@example.com", "latency_ms": rng.randint(1, 3000)}
            handle.write(json.dumps(record, separators=(",", ":")) + "\n")
            if index in (1000, 25000, 51000):
                handle.write('{"ts":"2026-09-28T12:00:00Z","level":"error","msg":"truncat\n')
    return {"lines": total, "errors": 1234, "top3": [["db timeout", 512], ["payment declined", 301], ["upstream 503", 244]], "invalid_lines": 3}


def write_types(directory, rng):
    users = []
    for index in range(1, 51):
        first, last = rng.choice(FIRST), rng.choice(LAST)
        city, country = rng.choice(CITIES)
        user = {
            "id": index,
            "name": f"{first} {last}",
            "email": f"{first.lower()}{index}@example.com",
            "roles": rng.sample(["admin", "editor", "viewer"], rng.randint(1, 2)),
            "address": {"street": f"{rng.randint(1, 99)} Main St", "city": city, "zip": f"{rng.randint(10000, 99999)}", "geo": {"lat": round(rng.uniform(-60, 60), 4), "lng": round(rng.uniform(-150, 150), 4)}},
            "deleted_at": None if rng.random() < 0.8 else "2026-01-02T03:04:05Z",
            "score": rng.choice([rng.randint(0, 100), round(rng.uniform(0, 100), 1)]),
        }
        if rng.random() < 0.4:
            user["middle_name"] = rng.choice(FIRST)
        users.append(user)
    users[0]["deleted_at"] = None
    users[1]["deleted_at"] = "2026-01-02T03:04:05Z"
    users[2]["middle_name"] = "Mary"
    users[3].pop("middle_name", None)
    response = {"data": {"users": users}, "page": {"next": None, "total": 50, "cursor": None}}
    with open(os.path.join(directory, "response.json"), "w") as handle:
        json.dump(response, handle, indent=2)
        handle.write("\n")
    return {"optional": ["middle_name"], "nullable": ["deleted_at"], "always_null": ["next", "cursor"]}


def main():
    out = sys.argv[1]
    rng = random.Random(20260929)
    truth = {}
    for name, writer in [("orders-explore", write_orders), ("api-diff", write_diff), ("config-repair", write_config), ("log-stats", write_logs), ("response-types", write_types)]:
        directory = os.path.join(out, name)
        os.makedirs(directory, exist_ok=True)
        truth[name] = writer(directory, rng)
    with open(os.path.join(out, "ground_truth.json"), "w") as handle:
        json.dump(truth, handle, indent=2)


if __name__ == "__main__":
    main()
