#!/usr/bin/env python3
"""Download recipe data from the Growtopia Wiki (growtopiawiki.com) through its public API.

It reads every item page and keeps only the recipe templates ({{RecipeSplice|...}},
{{RecipeCombine|...}}, {{RecipeCook|...}} and so on) and the {{Item|...}} line, plus the
cooking recipe templates and a few guide pages. About 180 API requests, a few minutes.

Usage (from the project root):
  pip install requests
  python tools/fetch_wiki.py          -> data/raw/wiki_dump.json
  python tools/build_data.py          -> js/data.js, js/items.js

Wiki content is CC BY-NC-SA 4.0. Please keep the request rate low.
"""
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

API = "https://growtopiawiki.com/api.php"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "raw" / "wiki_dump.json"
GUIDES = ["Guide:Combining", "Guide:Cooking", "Guide:Splicing/Recipe T1", "Guide:Splicing/Recipe T6",
          "Guide:Splicing/Recipe T11", "Guide:Crystals", "Guide:Sewing", "Guide:Forging", "Food Grinder",
          "Guide:Surgery", "Guide:Chemsynth", "DNA Processor", "Fossil Prep Station"]
HEAD = re.compile(r"^\s*(Recipe[A-Za-z0-9\-]*|Item)\s*[|}]")

session = requests.Session()
session.headers["User-Agent"] = "GrowDex recipe builder (personal fan project)"


def api(**params):
    params.update(format="json", formatversion="2", maxlag="5")
    while True:
        r = session.get(API, params=params, timeout=60).json()
        if r.get("error", {}).get("code") == "maxlag":
            time.sleep(5)
            continue
        if "error" in r:
            raise RuntimeError(r["error"])
        return r


def templates(text):
    """Top-level {{Recipe...}} and {{Item|...}} templates, with nested braces kept intact."""
    out, i = [], 0
    while True:
        j = text.find("{{", i)
        if j < 0:
            return out
        if HEAD.match(text[j + 2:j + 40]):
            depth, k = 0, j
            while k < len(text) - 1:
                if text[k:k + 2] == "{{":
                    depth += 1; k += 2; continue
                if text[k:k + 2] == "}}":
                    depth -= 1; k += 2
                    if depth == 0:
                        break
                    continue
                k += 1
            out.append(text[j:k])
            i = k
        else:
            i = j + 2


def main():
    pages, cont, n = {}, {}, 0
    while True:
        r = api(action="query", generator="allpages", gapnamespace=0, gaplimit=50, gapfilterredir="nonredirects",
                prop="revisions", rvprop="content", rvslots="main", **cont)
        for p in r.get("query", {}).get("pages", []):
            body = p.get("revisions", [{}])[0].get("slots", {}).get("main", {}).get("content", "")
            found = templates(body)
            if found:
                pages[p["title"]] = found
            n += 1
        print(f"\rpages read: {n}", end="", flush=True)
        if "continue" not in r:
            break
        cont = r["continue"]
        time.sleep(0.2)
    print()

    titles, cont = [], {}
    while True:
        r = api(action="query", list="allpages", apnamespace=10, aplimit=500, **cont)
        titles += [p["title"] for p in r["query"]["allpages"]]
        if "continue" not in r:
            break
        cont = r["continue"]
    cook_titles = [t for t in titles if t.endswith("Recipe") and not re.match(r"^Template:(Table)?Recipe", t)]
    cook = {}
    for i in range(0, len(cook_titles), 50):
        r = api(action="query", prop="revisions", rvprop="content", rvslots="main", titles="|".join(cook_titles[i:i + 50]))
        for p in r["query"]["pages"]:
            if "revisions" in p:
                cook[p["title"].replace("Template:", "")] = p["revisions"][0]["slots"]["main"]["content"]
        time.sleep(0.2)

    guides = {}
    for g in GUIDES:
        r = api(action="parse", page=g, prop="wikitext", redirects=1)
        guides[g] = r["parse"]["wikitext"]
        time.sleep(0.2)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"source": "https://growtopiawiki.com (CC BY-NC-SA 4.0)",
                               "fetched": datetime.now(timezone.utc).isoformat(),
                               "pages": pages, "cookTemplates": cook, "guides": guides}, ensure_ascii=False), encoding="utf-8")
    print(f"{len(pages)} item pages, {len(cook)} cooking templates, {len(guides)} guides -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
