import re
from datetime import date

import pytest

from market_brief import script, service as brief_service, sources
from market_brief.sources import FRED_CSV, PMMS_URL, Figure, collect, parse_fred_csv, parse_pmms_csv
from market_brief.tts import audio_config, chunks, voice_settings

PMMS = """date,pmms30,pmms30p,pmms15,pmms15p
09/24/2026,6.30,0.7,5.50,0.6
10/01/2026,6.25,0.7,5.45,0.6
10/08/2026,6.12,0.7,5.41,0.6
"""

TODAY = date(2026, 10, 9)


def fred(series, rows):
    return "observation_date," + series + "\n" + "\n".join(f"{d},{v}" for d, v in rows) + "\n"


FRED = {
    "MEDLISPRIGA": fred("MEDLISPRIGA", [("2025-09-01", "400000"), ("2026-08-01", "410000"), ("2026-09-01", "412500")]),
    "ACTLISCOUGA": fred("ACTLISCOUGA", [("2025-09-01", "40000"), ("2026-09-01", "44000")]),
    "MEDDAYONMARGA": fred("MEDDAYONMARGA", [("2026-09-01", "52")]),
    "MEDLISPRI12060": fred("MEDLISPRI12060", [("2026-09-01", ".")]),  # no current value
    "GASTHPI": fred("GASTHPI", [("2025-04-01", "500.0"), ("2026-04-01", "520.0")]),
    "GABPPRIVSA": fred("GABPPRIVSA", [("2026-08-01", "5100")]),
    "GAUR": fred("GAUR", [("2026-08-01", "3.6")]),
}


def fake_fetch(url):
    if url == PMMS_URL:
        return PMMS
    for series, text in FRED.items():
        if url == FRED_CSV.format(series=series):
            return text
    raise OSError("no such source")


def test_parses_freddie_mac_and_fred_files():
    assert parse_pmms_csv(PMMS)[-1] == (date(2026, 10, 8), 6.12, 5.41)
    assert parse_fred_csv(FRED["GAUR"], "GAUR") == [(date(2026, 8, 1), 3.6)]
    # Older FRED files name the date column DATE.
    assert parse_fred_csv("DATE,GAUR\n2026-08-01,3.6\n", "GAUR")[0][1] == 3.6
    with pytest.raises(ValueError):
        parse_fred_csv(FRED["MEDLISPRI12060"], "MEDLISPRI12060")


def test_collect_keeps_going_when_a_source_fails_and_says_which():
    figures, problems = collect(fake_fetch)
    ids = {f.id for f in figures}
    assert {"mortgage_30", "mortgage_15", "ga_median_list_price", "ga_unemployment"} <= ids
    assert "atl_median_list_price" not in ids
    assert [p["source"] for p in problems] == ["Realtor.com median listing price (MEDLISPRI12060)"]


def test_mortgage_rates_come_from_fred_first():
    def fetch(url):
        assert url != PMMS_URL, "Freddie Mac's site is only the fallback"
        series = "MORTGAGE30US" if "MORTGAGE30US" in url else "MORTGAGE15US"
        return fred(series, [("2026-10-01", "6.30"), ("2026-10-08", "6.12")])
    rates = sources.mortgage_rates(fetch)
    assert [r.id for r in rates] == ["mortgage_30", "mortgage_15"]
    assert rates[0].spoken_source == "Freddie Mac's weekly survey"


def test_mortgage_rates_fall_back_to_the_same_survey_on_fred():
    def fetch(url):
        if url == PMMS_URL:
            raise OSError("down")
        series = "MORTGAGE30US" if "MORTGAGE30US" in url else "MORTGAGE15US"
        return fred(series, [("2026-10-01", "6.25"), ("2026-10-08", "6.12")])
    rates = sources.mortgage_rates(fetch)
    assert [r.value for r in rates] == [6.12, 6.12]
    assert rates[0].source.startswith("Freddie Mac, via FRED")
    assert rates[0].change == -0.13


def test_year_over_year_change_uses_the_same_month_a_year_earlier():
    price = sources.fred_figure(sources.FRED_SERIES[0], fake_fetch)
    assert price.value == 412500 and price.change_pct == 3.1


def test_every_spoken_figure_names_its_source_and_period():
    figures, _ = collect(fake_fetch)
    text = script.market_script(figures, TODAY)
    assert text.startswith("Here is the Georgia market brief for Friday, October 9, 2026.")
    assert ("According to Freddie Mac's weekly survey, the national average 30-year fixed "
            "mortgage rate for the week of October 8, 2026 was 6.12 percent, down 0.13 percentage points "
            "from the week before.") in text
    assert ("According to Realtor.com, the median listing price in Georgia for September 2026 was $412,500, up 3.1 percent "
            "from a year earlier.") in text
    assert "According to the Federal Housing Finance Agency, the house price index in Georgia for the second quarter of 2026 was up 4.0 percent" in text
    assert "%" not in text
    for sentence in re.split(r"(?<=[a-z0-9])\. (?=[A-Z])", text):
        if any(ch.isdigit() for ch in sentence) and "brief for" not in sentence:
            assert sentence.startswith("According to "), sentence
    assert text.endswith(script.CLOSING)


def test_figures_that_are_no_longer_current_are_not_read():
    old = Figure("mortgage_30", "30-year fixed mortgage rate", 7.0, "percent", date(2026, 8, 1), "week",
                 "Freddie Mac Primary Mortgage Market Survey", "https://example.test", "United States")
    assert script.market_script([old], TODAY) == script.UNAVAILABLE
    assert script.display_items([old], TODAY) == []


def test_display_items_match_the_spoken_figures():
    figures, _ = collect(fake_fetch)
    items = script.display_items(figures, TODAY)
    first = items[0]
    assert first["label"] == "30-year fixed mortgage rate" and first["value"] == "6.12%"
    assert first["period"] == "the week of October 8, 2026"
    assert all(item["source"] and item["source_url"].startswith("https://") for item in items)
    index = next(i for i in items if i["id"] == "ga_house_price_index")
    assert index["value"] is None and index["change"] == "up 4.0% from a year earlier"


def test_tour_describes_the_site_without_figures():
    assert script.TOUR_SCRIPT.startswith("Welcome to DiamondEcho Realty.")
    assert "pause" in script.TOUR_SCRIPT
    assert not any(ch.isdigit() for ch in script.TOUR_SCRIPT)


def test_long_text_is_split_at_sentence_ends():
    text = " ".join(["This sentence is about forty bytes long."] * 300)
    parts = chunks(text, limit=500)
    assert all(len(p.encode()) <= 500 for p in parts)
    assert " ".join(parts) == text


def test_voice_defaults_to_a_natural_female_voice(monkeypatch):
    monkeypatch.delenv("MARKET_BRIEF_VOICE", raising=False)
    assert voice_settings() == {"languageCode": "en-US", "name": "en-US-Chirp3-HD-Aoede"}
    # Chirp 3 HD voices keep their own natural pace.
    assert audio_config() == {"audioEncoding": "MP3"}
    monkeypatch.setenv("MARKET_BRIEF_VOICE", "not a voice; drop table")
    assert voice_settings()["name"] == "en-US-Chirp3-HD-Aoede"
    monkeypatch.setenv("MARKET_BRIEF_VOICE", "en-US-Neural2-F")
    assert audio_config() == {"audioEncoding": "MP3", "speakingRate": 0.95}


def test_a_new_voice_records_the_day_again(monkeypatch):
    store = brief_service.MemoryStore()
    monkeypatch.setenv("MARKET_BRIEF_VOICE", "en-US-Neural2-F")
    old, _ = make_service(store)
    old_url = old.brief()["market"]["audio_url"]
    monkeypatch.setenv("MARKET_BRIEF_VOICE", "en-US-Chirp3-HD-Aoede")
    new, calls = make_service(store)
    body = new.brief()
    assert body["market"]["audio_url"] != old_url
    assert calls == {"collect": 1, "speak": 2}  # the tour and the day's brief, in the new voice


class Clock:
    now = 0.0

    def __call__(self):
        return self.now


def make_service(store=None, speak=lambda text: b"ID3" + text[:10].encode(), fetch=fake_fetch, clock=None):
    calls = {"collect": 0, "speak": 0}

    def counting_collect():
        calls["collect"] += 1
        return collect(fetch)

    def counting_speak(text):
        calls["speak"] += 1
        return speak(text)

    service = brief_service.MarketBriefService(store or brief_service.MemoryStore(), counting_collect,
                                               counting_speak, today=lambda: TODAY, clock=clock or Clock())
    return service, calls


def test_brief_is_built_once_a_day_and_reused():
    store = brief_service.MemoryStore()
    service, calls = make_service(store)
    first = service.brief()
    assert first["date"] == "2026-10-09"
    mk = brief_service.market_key(TODAY)
    assert mk.startswith("2026-10-09-")
    assert first["market"]["audio_url"] == f"/api/v1/market-brief/audio/{mk}.mp3"
    assert first["tour"]["audio_url"].startswith("/api/v1/market-brief/audio/tour-")
    assert service.brief() == first
    assert calls == {"collect": 1, "speak": 2}
    # A second instance reads the stored brief instead of calling sources or the voice.
    other, other_calls = make_service(store)
    assert other.brief()["market"]["items"] == first["market"]["items"]
    assert other_calls == {"collect": 0, "speak": 0}
    assert other.audio(mk).startswith(b"ID3")


def test_a_brief_without_audio_is_retried_later_and_never_stored():
    clock = Clock()
    store = brief_service.MemoryStore()

    def failing(text):
        raise RuntimeError("voice down")
    service, calls = make_service(store, speak=failing, clock=clock)
    body = service.brief()
    assert body["market"]["audio_url"] is None and body["tour"]["audio_url"] is None
    assert body["market"]["items"]  # the figures still show on the page
    assert store.rows == {}
    service.brief()
    assert calls["collect"] == 1
    clock.now += brief_service.RETRY_SECONDS + 1
    service.brief()
    assert calls["collect"] == 2


def test_audio_over_a_firestore_document_is_stored_in_parts_and_joined_again():
    big = bytes(range(256)) * 8000  # 2,048,000 bytes, like a long brief
    store = brief_service.MemoryStore()
    service, _ = make_service(store, speak=lambda text: big)
    body = service.brief()
    mk = brief_service.market_key(TODAY)
    assert body["market"]["audio_url"] == f"/api/v1/market-brief/audio/{mk}.mp3"
    assert store.rows[mk]["audio"] is None
    assert store.rows[mk]["audio_parts"] == 3
    assert all(len(row.get("data") or b"") <= brief_service.PART_BYTES for row in store.rows.values())
    other, calls = make_service(store)
    assert other.audio(mk) == big
    assert calls == {"collect": 0, "speak": 0}
    # A brief whose parts are incomplete is built again rather than served short.
    build = store.rows[mk]["audio_build"]
    del store.rows[f"{mk}-part-{build}1"]
    third, calls = make_service(store)
    third.brief()
    assert calls["collect"] == 1


def test_audio_keys_are_checked():
    service, _ = make_service()
    service.brief()
    for key in ("../secrets", "2026-10-10", "tour-zz"):
        with pytest.raises(KeyError):
            service.audio(key)


def test_the_brief_is_off_unless_switched_on(monkeypatch):
    monkeypatch.delenv("MARKET_BRIEF_ENABLED", raising=False)
    with pytest.raises(brief_service.BriefUnavailable):
        brief_service.get_service()


def test_routes(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from market_brief import router as brief_router

    app = FastAPI()
    app.include_router(brief_router.router, prefix="/api")
    client = TestClient(app)
    monkeypatch.delenv("MARKET_BRIEF_ENABLED", raising=False)
    assert client.get("/api/v1/market-brief").status_code == 503

    service, _ = make_service()
    monkeypatch.setattr(brief_router, "get_service", lambda: service)
    response = client.get("/api/v1/market-brief")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=600"
    body = response.json()
    assert body["not_used"][0]["source"] == "Georgia Realtors monthly market reports"
    audio = client.get(body["market"]["audio_url"])
    assert audio.status_code == 200 and audio.headers["content-type"] == "audio/mpeg"
    assert client.get("/api/v1/market-brief/audio/2020-01-01.mp3").status_code == 404


def test_the_service_mounts_the_brief_and_keeps_it_off_by_default():
    # A fresh interpreter, as in test_inquiries.py: tests/deal_intelligence
    # would shadow the service's own package.
    import os
    import subprocess
    import sys
    from pathlib import Path
    script = """
import sys
sys.path.insert(0, sys.argv[1])
import server
from fastapi.testclient import TestClient
with TestClient(server.app) as c:
    r = c.get('/api/v1/market-brief')
    assert r.status_code == 503, r.status_code
"""
    env = {k: v for k, v in os.environ.items() if k != "MARKET_BRIEF_ENABLED"}
    subprocess.run([sys.executable, "-c", script, str(Path(__file__).resolve().parents[1])], check=True, env=env)
