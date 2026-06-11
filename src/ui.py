from __future__ import annotations

import html

import pandas as pd
import streamlit as st


BHD_BLUE = "#1E3A5F"
BHD_BLUE_2 = "#2E5C8A"
BHD_ORANGE = "#E07B39"
BHD_RED = "#C0392B"
BHD_GREEN = "#27AE60"
BHD_BG = "#F4F6F9"
BHD_BORDER = "#DDE3EC"


def inject_theme() -> None:
    st.markdown(
        """
        <style>
        :root {
            --bhd-blue: #1E3A5F;
            --bhd-blue-2: #2E5C8A;
            --bhd-orange: #E07B39;
            --bhd-red: #C0392B;
            --bhd-green: #27AE60;
            --bhd-bg: #F4F6F9;
            --bhd-text: #2C3E50;
            --bhd-border: #DDE3EC;
        }
        .stApp { background: var(--bhd-bg); color: var(--bhd-text); }
        [data-testid="stHeader"] { background: transparent; }
        [data-testid="stSidebar"] {
            background: #FFFFFF;
            border-right: 1px solid var(--bhd-border);
        }
        [data-testid="stSidebarNav"] {
            display: none;
        }
        [data-testid="stSidebar"] [data-testid="stMarkdownContainer"] p,
        [data-testid="stSidebar"] label {
            font-size: .84rem;
            color: var(--bhd-text) !important;
        }
        [data-testid="stSidebar"] a,
        [data-testid="stSidebar"] span,
        [data-testid="stSidebar"] div {
            color: var(--bhd-text);
        }
        .main .block-container {
            max-width: 1200px;
            padding-top: 1.1rem;
            padding-bottom: 2.5rem;
        }
        h1, h2, h3 { color: var(--bhd-blue); letter-spacing: 0; }
        div[data-testid="stMetric"] {
            background: #FFFFFF;
            border-left: 4px solid var(--bhd-blue);
            border-radius: 8px;
            padding: 14px 16px;
            box-shadow: 0 1px 5px rgba(0,0,0,.07);
            min-height: 108px;
        }
        div[data-testid="stMetric"] label {
            color: #7A8794;
            font-size: .73rem;
            text-transform: uppercase;
            letter-spacing: .04em;
        }
        div[data-testid="stMetricValue"] {
            color: var(--bhd-blue);
            font-size: 1.45rem;
            font-weight: 750;
        }
        .bhd-header {
            background: var(--bhd-blue);
            color: #FFFFFF;
            border-radius: 8px;
            padding: 14px 18px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            box-shadow: 0 2px 8px rgba(0,0,0,.18);
            margin-bottom: 14px;
        }
        .bhd-brand {
            font-size: 1.05rem;
            font-weight: 800;
            line-height: 1.2;
        }
        .bhd-brand span { color: var(--bhd-orange); }
        .bhd-sub {
            color: rgba(255,255,255,.74);
            font-size: .78rem;
            margin-top: 2px;
        }
        .bhd-header-right {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
            flex-wrap: wrap;
        }
        .bhd-pill {
            display: inline-flex;
            align-items: center;
            border-radius: 999px;
            padding: 4px 10px;
            font-size: .75rem;
            font-weight: 750;
            white-space: nowrap;
            background: var(--bhd-orange);
            color: #FFFFFF;
        }
        .bhd-pill.secondary {
            background: rgba(255,255,255,.13);
            color: rgba(255,255,255,.9);
            border: 1px solid rgba(255,255,255,.2);
        }
        .bhd-page-title {
            color: var(--bhd-blue);
            font-size: 1.25rem;
            font-weight: 800;
            margin: 6px 0 2px;
        }
        .bhd-caption {
            color: #7A8794;
            font-size: .84rem;
            margin-bottom: 14px;
        }
        .bhd-panel {
            background: #FFFFFF;
            border: 1px solid var(--bhd-border);
            border-radius: 8px;
            padding: 16px;
            box-shadow: 0 1px 5px rgba(0,0,0,.06);
            margin-bottom: 16px;
        }
        .bhd-section-title {
            color: var(--bhd-blue);
            font-size: .9rem;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: .03em;
            margin-bottom: 10px;
        }
        .bhd-filter-card {
            background: #EEF3FA;
            border: 1px solid var(--bhd-border);
            border-radius: 8px;
            padding: 10px 12px;
            margin: 8px 0 8px;
        }
        .bhd-filter-card .label {
            color: var(--bhd-blue);
            font-weight: 800;
            font-size: .78rem;
            text-transform: uppercase;
            letter-spacing: .04em;
            margin-bottom: 8px;
        }
        .bhd-range-badge {
            background: var(--bhd-blue);
            color: #FFFFFF;
            border-radius: 999px;
            padding: 5px 10px;
            font-size: .76rem;
            font-weight: 750;
            text-align: center;
            margin: 6px 0 10px;
            display: inline-block;
        }
        .bhd-top-nav {
            background: #FFFFFF;
            border: 1px solid var(--bhd-border);
            border-radius: 8px;
            padding: 6px;
            margin: -4px 0 14px;
            box-shadow: 0 1px 5px rgba(0,0,0,.05);
        }
        .bhd-top-nav [data-testid="stPageLink"] {
            background: transparent;
            border-radius: 6px;
            min-height: 36px;
        }
        .bhd-top-nav [data-testid="stPageLink"] a,
        .bhd-top-nav [data-testid="stPageLink"] span,
        .bhd-top-nav a {
            color: var(--bhd-blue) !important;
            font-weight: 750;
            text-decoration: none;
            font-size: .84rem;
        }
        .bhd-top-nav [data-testid="stPageLink"]:hover {
            background: #EEF3FA;
        }
        .bhd-filter-row {
            background: #EEF3FA;
            border: 1px solid var(--bhd-border);
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 14px;
        }
        .bhd-filter-row label,
        [data-testid="stDateInput"] label,
        [data-testid="stSelectbox"] label,
        [data-testid="stTextInput"] label {
            color: var(--bhd-text) !important;
            font-weight: 700;
        }
        .stButton > button {
            border-radius: 7px;
            border: 1px solid var(--bhd-border);
            font-weight: 750;
            background: #FFFFFF;
            color: var(--bhd-blue) !important;
        }
        [data-testid="stBaseButton-primary"],
        .stDownloadButton [data-testid="stBaseButton-primary"] {
            background: var(--bhd-green);
            border-color: var(--bhd-green);
            color: #FFFFFF !important;
        }
        [data-baseweb="input"] input,
        [data-baseweb="select"] span,
        [data-testid="stDateInput"] input,
        [data-testid="stTextInput"] input {
            color: var(--bhd-text) !important;
            background: #FFFFFF !important;
        }
        [data-baseweb="popover"] {
            color: var(--bhd-text) !important;
        }
        [data-testid="stMarkdownContainer"],
        [data-testid="stCaptionContainer"],
        [data-testid="stAlert"] {
            color: var(--bhd-text);
        }
        [data-testid="stDataFrame"] {
            border: 1px solid var(--bhd-border);
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 1px 5px rgba(0,0,0,.05);
        }
        @media (max-width: 700px) {
            .bhd-header {
                align-items: flex-start;
                flex-direction: column;
            }
            .bhd-header-right { justify-content: flex-start; }
            div[data-testid="stMetric"] { min-height: 92px; }
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def render_header(transactions: int = 0, card_last4: str | None = None) -> None:
    card_text = f"Tarjeta: **** {html.escape(card_last4)}" if card_last4 else "Tarjeta: ****"
    st.markdown(
        f"""
        <div class="bhd-header">
          <div>
            <div class="bhd-brand">Simulador de Consumos <span>BHD</span></div>
            <div class="bhd-sub">Dashboard financiero de consumos importados desde Gmail</div>
          </div>
          <div class="bhd-header-right">
            <span class="bhd-pill secondary">{card_text}</span>
            <span class="bhd-pill">{transactions} transacciones</span>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_top_nav() -> None:
    st.markdown('<div class="bhd-top-nav">', unsafe_allow_html=True)
    cols = st.columns(7)
    pages = [
        ("Dashboard", "app.py", "Dashboard"),
        ("Consumos", "pages/1_📋_Consumos.py", "Consumos"),
        ("Categorías", "pages/2_🏷️_Categorias.py", "Categorías"),
        ("Por Día", "pages/3_📅_Por_Dia.py", "Por Día"),
        ("Comercios", "pages/4_🏪_Comercios.py", "Comercios"),
        ("Alertas", "pages/5_🚨_Alertas.py", "Alertas"),
        ("Exportar", "pages/6_📥_Exportar.py", "Exportar"),
    ]
    for col, (label, path, help_text) in zip(cols, pages):
        with col:
            st.page_link(path, label=label, help=help_text)
    st.markdown("</div>", unsafe_allow_html=True)


def render_page_title(title: str, subtitle: str = "") -> None:
    safe_title = html.escape(title)
    safe_subtitle = html.escape(subtitle)
    st.markdown(f'<div class="bhd-page-title">{safe_title}</div>', unsafe_allow_html=True)
    if subtitle:
        st.markdown(f'<div class="bhd-caption">{safe_subtitle}</div>', unsafe_allow_html=True)


def render_panel_start(title: str) -> None:
    st.markdown(
        f'<div class="bhd-section-title">{html.escape(title)}</div>',
        unsafe_allow_html=True,
    )


def card_last4_from_df(df: pd.DataFrame) -> str | None:
    if df.empty:
        return None
    col = "tarjeta" if "tarjeta" in df.columns else "card_last4"
    if col not in df.columns:
        return None
    values = df[col].dropna().astype(str)
    return values.iloc[0][-4:] if not values.empty else None
