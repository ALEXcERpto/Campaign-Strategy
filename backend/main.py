#!/usr/bin/env python3
import os
import re
import json
import asyncio
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
import anthropic
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

PROMPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = PROMPT_DIR


class GenerateRequest(BaseModel):
    url: str


def fetch_website(url: str) -> str:
    headers = {"User-Agent": "Mozilla/5.0 (compatible; ResearchBot/1.0)"}
    resp = requests.get(url, headers=headers, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    text = soup.get_text(separator="\n", strip=True)
    return text[:8000]


def company_name_from_url(url: str) -> str:
    domain = urlparse(url).netloc
    domain = re.sub(r"^www\.", "", domain)
    name = domain.split(".")[0]
    return name.capitalize()


def read_prompt(filename: str) -> str:
    path = os.path.join(PROMPT_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


async def pipeline_stream(url: str):
    client = anthropic.AsyncAnthropic()

    def event(data: dict) -> str:
        return json.dumps(data)

    try:
        yield event({"type": "website_fetch"})
        website_content = await asyncio.to_thread(fetch_website, url)
        company = company_name_from_url(url)

        steps = [
            {"step": 1, "name": "Market Research"},
            {"step": 2, "name": "TAM Mapping"},
            {"step": 3, "name": "ICP Mapping"},
            {"step": 4, "name": "Campaign Strategy"},
        ]

        outputs = {}

        for meta in steps:
            step_num = meta["step"]
            step_name = meta["name"]

            yield event({"type": "step_start", "step": step_num, "name": step_name})

            # Build prompt
            if step_num == 1:
                prompt = read_prompt("Marketrearch.md")
                prompt = prompt.replace("[CLIENT_COMPANY]", company)
                prompt += f"\n\n---\n\n## WEBSITE CONTENT\n\n{website_content}"
            elif step_num == 2:
                prompt = read_prompt("TAM Mapping.md")
                prompt = prompt.replace("[CLIENT_COMPANY]", company)
                prompt = prompt.replace("[PASTE_STEP_1_OUTPUT]", outputs[1])
            elif step_num == 3:
                prompt = read_prompt("ICP Mapping.md")
                prompt = prompt.replace("[CLIENT_COMPANY]", company)
                prompt = prompt.replace("[PASTE_STEP_2_OUTPUT]", outputs[2])
                prompt = prompt.replace("[ONBOARDING_FORM]", "(No onboarding form — use research data only)")
            else:
                prompt = read_prompt("Campaign Strategy.md")
                prompt += f"""

---

## RESEARCH DATA

All required inputs have been collected from prior research. Using the data below, generate a complete campaign document (Sections 1–4 including dream company research, targeting, and copy variants). Infer dream companies from the ICP and market research. Do not request additional inputs.

### Company: {company}

### Market Research (Step 1):

{outputs[1]}

---

### TAM Mapping (Step 2):

{outputs[2]}

---

### ICP Mapping (Step 3):

{outputs[3]}

---

Now execute the full campaign document output using the research above.
"""

            full_text = ""
            async with client.messages.stream(
                model="claude-opus-4-6",
                max_tokens=8096,
                messages=[{"role": "user", "content": prompt}],
            ) as stream:
                async for text in stream.text_stream:
                    full_text += text
                    yield event({"type": "token", "step": step_num, "text": text})

            outputs[step_num] = full_text
            yield event({"type": "step_end", "step": step_num})

        # Save combined output
        output_filename = f"{company.lower()}_campaign.md"
        output_path = os.path.join(OUTPUT_DIR, output_filename)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(f"# Campaign Strategy: {company}\n\n")
            f.write("---\n\n")
            f.write("## Step 1: Market Research\n\n")
            f.write(outputs[1])
            f.write("\n\n---\n\n")
            f.write("## Step 2: TAM Mapping\n\n")
            f.write(outputs[2])
            f.write("\n\n---\n\n")
            f.write("## Step 3: ICP Mapping\n\n")
            f.write(outputs[3])
            f.write("\n\n---\n\n")
            f.write("## Step 4: Campaign Strategy\n\n")
            f.write(outputs[4])

        yield event({"type": "done", "filename": output_filename})

    except Exception as e:
        yield event({"type": "error", "message": str(e)})


@app.post("/generate")
async def generate(req: GenerateRequest):
    async def event_generator():
        async for data in pipeline_stream(req.url):
            yield {"data": data}

    return EventSourceResponse(event_generator())


@app.get("/download/{filename}")
async def download(filename: str):
    path = os.path.join(OUTPUT_DIR, filename)
    if not os.path.exists(path):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path, media_type="text/markdown", filename=filename)
