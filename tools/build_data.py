#!/usr/bin/env python3
"""Build GrowDex data from a Growtopia Wiki dump.

Input:  data/raw/wiki_dump.json   (made by tools/fetch_wiki.py)
Output: js/data.js                window.GS_DATA, every recipe system (loaded by index.html)
        js/items.js               window.GS_ITEMS, item descriptions + other ways to get items
        data/recipes.json         every recipe in a readable form
        data/obtain.json          every other way to get each item

Every item page on growtopiawiki.com lists how the item is made with templates
such as {{RecipeSplice|A|B}} or {{RecipeCombine|A|1|B|2|C|3|1}}. This script reads
those templates, so the data covers every item page, not just the guide pages.

Run from the project root:  python tools/build_data.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DUMP = ROOT / "data" / "raw" / "wiki_dump.json"
LEGACY = ROOT / "data" / "legacy_splicables.txt"

CRYSTAL = {"R": "Red Crystal", "G": "Green Crystal", "B": "Blue Crystal", "W": "White Crystal", "K": "Black Crystal"}
DNA = {"A": "Dino DNA Strand A-273", "C": "Dino DNA Strand C-904", "G": "Dino DNA Strand G-137", "T": "Dino DNA Strand T-658",
       "X": "Plant DNA Strand X-277", "Y": "Plant DNA Strand Y-985", "L": "Raptor DNA Strand Alpha", "O": "Raptor DNA Strand Omega"}
BOLT = {"R": "Silk Bolt - Red", "G": "Silk Bolt - Green", "B": "Silk Bolt - Blue", "W": "Silk Bolt - White", "K": "Silk Bolt - Black",
        "E": "Silk Bolt - Grey", "Y": "Silk Bolt - Yellow", "P": "Silk Bolt - Purple", "A": "Silk Bolt - Aqua", "O": "Wool Bolt",
        "F": "Silk Bolt - Floral", "WW": "Woven Wood Bolt", "BT": "Broken Tea Basket"}
STITCH = {"S": "Straight Stitch", "Z": "Zigzag Stitch", "O": "Overcasting Stitch", "L": "Locking Stitch",
          "T": "Triple Stretch Stitch", "A": "Saddle Stitch", "B": "Blind Stitch"}
MACHINE = {"LM": "Laboratory / Microwave"}

# Templates turned into recipe systems; everything else becomes an "obtain" note
SYSTEM_TEMPLATES = {"RecipeSplice", "RecipeCombine", "RecipeCook", "RecipeGrind", "RecipeCrystal", "RecipeSew", "RecipeForge",
                    "RecipeDNA", "RecipeFruitMixer", "RecipeCut", "RecipeSurgery", "RecipeChemsynth", "RecipeFossilPrep",
                    "RecipeCompact", "RecipeAnomalizer"}
SKIP_OBTAIN = {"Item", "Recipe", "RecipeNone", "RecipeUnknown"}


# ---------------------------------------------------------------- wiki text helpers
def split_params(s):
    """'{{Name|a|b|k=v}}' -> (name, [positional], {named}), respecting nested {{ }} and [[ ]]."""
    body = s[2:-2]
    parts, cur, depth, sq, i = [], "", 0, 0, 0
    while i < len(body):
        two = body[i:i + 2]
        if two in ("{{", "}}", "[[", "]]"):
            depth += {"{{": 1, "}}": -1}.get(two, 0)
            sq += {"[[": 1, "]]": -1}.get(two, 0)
            cur += two
            i += 2
            continue
        if body[i] == "|" and depth == 0 and sq == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += body[i]
        i += 1
    parts.append(cur)
    name, pos, named = parts[0].strip(), [], {}
    for p in parts[1:]:
        m = re.match(r"^\s*([A-Za-z][A-Za-z0-9 /_\-]*)\s*=(.*)$", p, re.S)
        if m and "{{" not in m.group(1):
            named[m.group(1).strip()] = m.group(2).strip()
        else:
            pos.append(p.strip())
    return name, pos, named


def clean(text, page=""):
    """Wiki markup -> plain text."""
    t = text.replace("{{PAGENAME}}", page)
    for _ in range(4):
        t = re.sub(r"\{\{\s*ItemLink\s*\|([^|{}]+)(\|[^{}]*)?\}\}", r"\1", t)
        t = re.sub(r"\{\{\s*Sprite\s*\|[^{}]*\}\}", "", t)
        t = re.sub(r"\{\{[^{}]*\}\}", "", t)
    t = re.sub(r"\[\[(?:File|Image):[^\]]*\]\]", "", t)
    t = re.sub(r"\[\[[^|\]]*\|([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\[\[([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\[https?://\S+ ([^\]]*)\]", r"\1", t)
    t = re.sub(r"<br\s*/?>", " ", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = t.replace("'''", "").replace("''", "").replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", t).strip(" ,.")


CURRENCY = {"G": "gems", "T": "Growtokens", "V": "Grow Vouchers", "USD": "USD", "WL": "World Locks"}
NPC = {"LB": "Lock-Bot", "N": "Nutcracker", "PT": "Pet Trainer", "L": "Locke The Salesman", "S": "Snack Fu", "B": "The Bartender", "SS": "Shady Salesman"}


def obtain_text(kind, p, named, page):
    """Short English text for the ways to get an item that are not crafting systems."""
    c = lambda v: clean(v, page)
    if kind == "Store":
        return f"{c(p[0])} — {c(p[1])} {CURRENCY.get(p[2].upper(), p[2])}".strip(" —")
    if kind in ("Consume", "Use"):
        return f"{c(p[0])} ×{num(p[1], 100)} → {num(p[2])}" + (" (random)" if p[3] == "R" else "")
    if kind == "Provider":
        return f"{c(p[0])} → {num(p[1])}"
    if kind == "Break":
        return f"{c(p[0])} → {c(p[1]) or 1}"
    if kind == "Fish":
        return ", ".join(c(x) for x in p if x) or "any bait"
    if kind == "NPC":
        return f"{NPC.get(p[0], 'Locke / Lock-Bot')}: {c(p[2])} {c(p[1])} → {num(p[3])}"
    if kind == "Custom":
        return c(p[2] or p[1])[:150]
    txt = c(" · ".join(x for x in p if x))
    if not txt and named:
        txt = c(" · ".join(v for k, v in named.items() if k.lower() != "background"))
    return txt[:120]


def num(v, default=1):
    m = re.search(r"\d[\d,]*", v or "")
    return int(m.group().replace(",", "")) if m else default


# ---------------------------------------------------------------- systems
def parse(dump):
    pages, cook_tpl = dump["pages"], dump["cookTemplates"]
    R = {k: [] for k in ["splice", "combine", "cook", "grind", "crystal", "sew", "forge", "dna", "fruit", "other"]}
    obtain, desc, page_of = {}, {}, {}

    for title, temps in pages.items():
        if "/" in title:
            continue                      # sub-pages (update notes etc.) are not items
        parsed = [split_params(s) for s in temps]
        boxes = [named.get("name", "") for name, _, named in parsed if name == "Item"]
        # pages that hold several items (levels, colours, disambiguation pages) start each one with {{Item|name=...}}
        several = len(boxes) > 1 or "(disambiguation)" in title
        out = title
        for name, pos, named in parsed:
            p = pos + [""] * 12
            if name == "Item":
                if several and named.get("name"):
                    out = clean(named["name"], title)
                    if out != title:
                        page_of[out] = title      # its wiki page has another name
                if pos and pos[0]:
                    desc[out] = clean(pos[0], out)
                continue
            if name == "RecipeSplice":
                flag = next((x for x in (p[2], p[3]) if x in ("W", "MK")), "")
                if "[EventLimited]" in (p[2], p[3]):
                    flag = "EL"                   # only while an event is running
                orig = p[2] if p[2] and p[2] not in ("W", "MK") and not p[2].isdigit() and not p[2].startswith("[") else ""
                R["splice"].append({"out": out, "a": p[0], "b": p[1], "event": flag,
                                    "chance": named.get("type") == "chance", "normally": orig})
            elif name == "RecipeCombine":
                ins = [{"n": p[i], "q": num(p[i + 1])} for i in (0, 2, 4) if p[i]]
                R["combine"].append({"out": out, "in": ins, "yield": num(named.get("Amount given") or p[6]),
                                     "chance": named.get("Chance") == "Y", "machine": MACHINE.get(p[7], p[7])})
            elif name == "RecipeCook":
                tpl = cook_tpl.get(p[0] + "Recipe", "")
                steps, punch = [], ""
                for row in tpl.split("|-"):
                    cells = [c.strip() for c in row.strip().split("\n|") if c.strip()]
                    cells = [c.lstrip("|").strip() for c in cells]
                    if len(cells) < 2:
                        continue
                    if "Punch" in cells[0]:
                        punch = clean(cells[1])
                        continue
                    q = re.match(r"^(\d+)\s*[×x]", cells[0])
                    steps.append({"n": clean(cells[0]).split("×")[-1].strip(), "q": int(q.group(1)) if q else 1,
                                  "t": clean(cells[1]).replace(" (optional spice)", ""),
                                  "opt": "optional" in cells[1]})
                R["cook"].append({"out": out, "steps": steps, "punch": punch, "quality": p[1], "shares": p[2]})
            elif name == "RecipeGrind":
                alts = [{"n": p[i], "q": num(p[i + 1])} for i in range(0, 10, 2) if p[i]]
                R["grind"].append({"out": out, "alts": alts, "chance": named.get("Chance") == "Y"})
            elif name == "RecipeCrystal":
                R["crystal"].append({"out": out, "in": [CRYSTAL.get(c.upper(), c) for c in p[:5]], "yield": num(p[5])})
            elif name == "RecipeSew":
                R["sew"].append({"out": out, "start": BOLT.get(p[0].upper(), p[0]), "stitch1": STITCH.get(p[1].upper(), p[1]),
                                 "bolt2": BOLT.get(p[2].upper(), p[2]), "stitch2": STITCH.get(p[3].upper(), p[3]),
                                 "bolt3": BOLT.get(p[4].upper(), p[4]), "yield": num(p[5])})
            elif name == "RecipeForge":
                R["forge"].append({"out": out, "n": p[0], "q": num(p[1], 100)})
            elif name == "RecipeDNA":
                R["dna"].append({"out": out, "in": [DNA.get(c.upper(), c) for c in p[:3]], "yield": num(p[3])})
            elif name == "RecipeFruitMixer":
                R["fruit"].append({"out": out, "yield": num(p[0]), "fruit": p[1]})
            elif name == "RecipeCut":
                src = "Fish" if p[0] == "F" else (p[1] + " (perfect)" if p[0] == "PF" else p[0])
                R["other"].append({"out": out, "how": "cut", "from": src, "note": clean(named.get("Desc", ""))})
            elif name == "RecipeSurgery":
                R["other"].append({"out": out, "how": "surgery", "rare": p[0] in ("2",), "q": num(p[1]),
                                   "where": "op" if p[0] == "5" else "bed"})
            elif name == "RecipeChemsynth":
                R["other"].append({"out": out, "how": "chemsynth", "pandemic": p[0] == "P", "q": num(p[1])})
            elif name == "RecipeFossilPrep":
                R["other"].append({"out": out, "how": "fossil", "from": {"F": "Fossil", "P": "Polished Fossil"}.get(p[0], "Fossil / Polished Fossil")})
            elif name == "RecipeCompact":
                R["other"].append({"out": out, "how": "compact", "from": "Fashionable Dress / Stylin' Dress" if p[0] == "D" else "splicable clothing"})
            elif name == "RecipeAnomalizer":
                R["other"].append({"out": out, "how": "anomalizer"})
            elif name not in SKIP_OBTAIN:
                kind = name[6:] or name
                obtain.setdefault(out, []).append([kind, obtain_text(kind, p, named, out)])
    return R, obtain, desc, page_of


# ---------------------------------------------------------------- combine categories from Guide:Combining
def combine_categories(guide):
    cats, cur, event = {}, "Other", False
    for line in guide.splitlines():
        m = re.match(r"^\s*(?:\|-\|)?\s*([A-Z][A-Za-z !'&.-]+?)\s*=\s*$", line)
        if m:
            cur = m.group(1).strip()
            if cur == "Anniversary Week":
                event = True
            continue
        for item in re.findall(r"\{\{ItemLink\|([^|}]+)", line):
            cats.setdefault(item, ("Event: " if event else "") + cur)
    return cats


def splice_tiers(splice):
    by = {}
    for r in splice:
        if not r["chance"]:
            by.setdefault(r["out"], r)
    memo = {}

    def tier(n, depth=0):
        if n not in by or depth > 40:
            return 1
        if n in memo:
            return memo[n]
        memo[n] = 1
        memo[n] = max(tier(by[n]["a"], depth + 1), tier(by[n]["b"], depth + 1)) + 1
        return memo[n]
    for r in splice:
        r["tier"] = tier(r["out"]) if not r["chance"] else max(tier(r["a"]), tier(r["b"])) + 1


def legacy_rarity():
    rar = {}
    if LEGACY.exists():
        for line in LEGACY.read_text(encoding="utf-8", errors="ignore").splitlines():
            m = re.match(r"//\s*(.+?)\s*\[R(\d+)\]\s*=", line)
            if m:
                rar[m.group(1)] = int(m.group(2))
    return rar


# ---------------------------------------------------------------- compact output for the web page
def main():
    if not DUMP.exists():
        sys.exit(f"{DUMP} not found - run tools/fetch_wiki.py first")
    dump = json.loads(DUMP.read_text(encoding="utf-8"))
    R, obtain, desc, page_of = parse(dump)
    splice_tiers(R["splice"])
    cats = combine_categories(dump["guides"].get("Guide:Combining", ""))
    for r in R["combine"]:
        r["cat"] = cats.get(r["out"], "Other")
    rar = legacy_rarity()

    names = set()
    for sysname, rows in R.items():
        for r in rows:
            names.add(r["out"])
            for k in ("a", "b", "n", "start", "bolt2", "bolt3", "fruit", "normally"):
                if r.get(k):
                    names.add(r[k])
            for k in ("in", "steps", "alts"):
                for x in r.get(k, []):
                    names.add(x["n"] if isinstance(x, dict) else x)
    names |= set(obtain)
    names = sorted((n for n in names if n), key=str.lower)
    ix = {n: i for i, n in enumerate(names)}
    I = lambda n: ix[n] if n else -1

    cat_list = sorted({r["cat"] for r in R["combine"]}, key=lambda c: (c.startswith("Event"), c == "Other", c))
    data = {
        "fetched": dump.get("fetched", "")[:10],
        "names": names,
        "cats": cat_list,
        "splice": [[I(r["out"]), I(r["a"]), I(r["b"]), r["tier"], rar.get(r["out"], 0), r["event"], int(r["chance"]), I(r["normally"])] for r in R["splice"]],
        "combine": [[I(r["out"]), [[I(x["n"]), x["q"]] for x in r["in"]], r["yield"], int(r["chance"]), r["machine"], cat_list.index(r["cat"])] for r in R["combine"]],
        "cook": [[I(r["out"]), [[I(s["n"]), s["q"], s["t"], int(s["opt"])] for s in r["steps"]], r["punch"], r["quality"], I(r["shares"]) if r["shares"] in ix else -1] for r in R["cook"]],
        "grind": [[I(r["out"]), [[I(x["n"]), x["q"]] for x in r["alts"]], int(r["chance"])] for r in R["grind"]],
        "crystal": [[I(r["out"]), [I(x) for x in r["in"]], r["yield"]] for r in R["crystal"]],
        "sew": [[I(r["out"]), I(r["start"]), r["stitch1"], I(r["bolt2"]), r["stitch2"], I(r["bolt3"]), r["yield"]] for r in R["sew"]],
        "forge": [[I(r["out"]), I(r["n"]), r["q"]] for r in R["forge"]],
        "dna": [[I(r["out"]), [I(x) for x in r["in"]], r["yield"]] for r in R["dna"]],
        "fruit": [[I(r["out"]), r["yield"], I(r["fruit"])] for r in R["fruit"]],
        "other": [[I(r["out"]), r["how"], {k: v for k, v in r.items() if k not in ("out", "how")}] for r in R["other"]],
    }
    items = {
        "obtain": {str(ix[n]): v for n, v in obtain.items()},
        "desc": {str(ix[n]): (v[:150] + "…" if len(v) > 150 else v) for n, v in desc.items() if n in ix},
        "page": {str(ix[n]): v for n, v in page_of.items() if n in ix},
    }
    js = "/* Generated by tools/build_data.py from the Growtopia Wiki (CC BY-NC-SA 4.0). Do not edit by hand. */\n"
    js += "window.GS_DATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (ROOT / "js" / "data.js").write_text(js, encoding="utf-8")
    js2 = "/* Generated by tools/build_data.py: item descriptions and other ways to get items (Growtopia Wiki, CC BY-NC-SA 4.0). */\n"
    js2 += "window.GS_ITEMS=" + json.dumps(items, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (ROOT / "js" / "items.js").write_text(js2, encoding="utf-8")
    (ROOT / "data" / "recipes.json").write_text(json.dumps(R, ensure_ascii=False, indent=1), encoding="utf-8")
    (ROOT / "data" / "obtain.json").write_text(json.dumps(obtain, ensure_ascii=False, indent=1), encoding="utf-8")
    print("items", len(names), "| " + " | ".join(f"{k} {len(v)}" for k, v in R.items()), f"| obtain {len(obtain)}",
          f"| js/data.js {len(js) // 1024} KB, js/items.js {len(js2) // 1024} KB")


if __name__ == "__main__":
    main()
