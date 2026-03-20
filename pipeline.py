#!/usr/bin/env python3
import sys
import os
import re
from urllib.parse import urlparse

import anthropic
import requests
from bs4 import BeautifulSoup

PROMPT_DIR = os.path.dirname(os.path.abspath(__file__))


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


def run_agent(client: anthropic.Anthropic, prompt: str, step_name: str) -> str:
    print(f"[{step_name}] Running...")
    response = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=8096,
        messages=[{"role": "user", "content": prompt}],
    )
    result = response.content[0].text
    print(f"[{step_name}] Complete")
    return result


def main():
    if len(sys.argv) < 2:
        print("Usage: python pipeline.py <url>")
        sys.exit(1)

    url = sys.argv[1]
    company = company_name_from_url(url)

    print(f"Company: {company}")
    print(f"URL: {url}")
    print()

    print("[Website] Fetching...")
    website_content = fetch_website(url)
    print("[Website] Done")
    print()

    client = anthropic.Anthropic()

    # Step 1: Market Research
    market_research_prompt = read_prompt("Marketrearch.md")
    market_research_prompt = market_research_prompt.replace("[CLIENT_COMPANY]", company)
    market_research_prompt += f"\n\n---\n\n## WEBSITE CONTENT\n\n{website_content}"
    market_research_output = run_agent(client, market_research_prompt, "Step 1: Market Research")

    # Step 2: TAM Mapping
    tam_prompt = read_prompt("TAM Mapping.md")
    tam_prompt = tam_prompt.replace("[CLIENT_COMPANY]", company)
    tam_prompt = tam_prompt.replace("[PASTE_STEP_1_OUTPUT]", market_research_output)
    tam_output = run_agent(client, tam_prompt, "Step 2: TAM Mapping")

    # Step 3: ICP Mapping
    icp_prompt = read_prompt("ICP Mapping.md")
    icp_prompt = icp_prompt.replace("[CLIENT_COMPANY]", company)
    icp_prompt = icp_prompt.replace("[PASTE_STEP_2_OUTPUT]", tam_output)
    icp_prompt = icp_prompt.replace("[ONBOARDING_FORM]", "(No onboarding form — use research data only)")
    icp_output = run_agent(client, icp_prompt, "Step 3: ICP Mapping")

    # Step 4: Campaign Strategy
    campaign_prompt = read_prompt("Campaign Strategy.md")
    campaign_prompt += f"""

---

## RESEARCH DATA

All required inputs have been collected from prior research. Using the data below, generate a complete campaign document (Sections 1–4 including dream company research, targeting, and copy variants). Infer dream companies from the ICP and market research. Do not request additional inputs.

### Company: {company}

### Market Research (Step 1):

{market_research_output}

---

### TAM Mapping (Step 2):

{tam_output}

---

### ICP Mapping (Step 3):

{icp_output}

---

Now execute the full campaign document output using the research above.
"""
    campaign_output = run_agent(client, campaign_prompt, "Step 4: Campaign Strategy")

    # Save combined output
    output_filename = f"{company.lower()}_campaign.md"
    output_path = os.path.join(PROMPT_DIR, output_filename)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(f"# Campaign Strategy: {company}\n\n")
        f.write("---\n\n")
        f.write("## Step 1: Market Research\n\n")
        f.write(market_research_output)
        f.write("\n\n---\n\n")
        f.write("## Step 2: TAM Mapping\n\n")
        f.write(tam_output)
        f.write("\n\n---\n\n")
        f.write("## Step 3: ICP Mapping\n\n")
        f.write(icp_output)
        f.write("\n\n---\n\n")
        f.write("## Step 4: Campaign Strategy\n\n")
        f.write(campaign_output)

    print()
    print(f"Output saved to: {output_path}")


if __name__ == "__main__":
    main()
