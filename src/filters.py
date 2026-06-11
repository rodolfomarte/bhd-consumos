from __future__ import annotations

from datetime import date

import pandas as pd
import streamlit as st


DATE_START_KEY = "fecha_inicio_global"
DATE_END_KEY = "fecha_fin_global"
DATE_START_WIDGET_KEY = "_fecha_inicio_widget"
DATE_END_WIDGET_KEY = "_fecha_fin_widget"


def _date_bounds(df: pd.DataFrame) -> tuple[date | None, date | None]:
    fechas = pd.to_datetime(df["fecha"], format="%d/%m/%Y", errors="coerce").dropna()
    if fechas.empty:
        return None, None
    return fechas.min().date(), fechas.max().date()


def _sync_widget_dates() -> None:
    start = st.session_state.get(DATE_START_WIDGET_KEY)
    end = st.session_state.get(DATE_END_WIDGET_KEY)
    if start is None or end is None:
        return
    st.session_state[DATE_START_KEY] = start
    st.session_state[DATE_END_KEY] = end


def render_date_filter(df: pd.DataFrame, container=None) -> tuple[date | None, date | None]:
    if container is None:
        container = st

    min_date, max_date = _date_bounds(df)
    if min_date is None or max_date is None:
        return None, None

    current_start = st.session_state.get(DATE_START_KEY, min_date)
    current_end = st.session_state.get(DATE_END_KEY, max_date)

    if current_start < min_date or current_start > max_date:
        current_start = min_date
    if current_end < min_date or current_end > max_date:
        current_end = max_date
    if current_start > current_end:
        current_start, current_end = min_date, max_date

    st.session_state[DATE_START_KEY] = current_start
    st.session_state[DATE_END_KEY] = current_end
    st.session_state[DATE_START_WIDGET_KEY] = current_start
    st.session_state[DATE_END_WIDGET_KEY] = current_end

    container.markdown(
        '<div class="bhd-filter-card"><div class="label">Período global</div></div>',
        unsafe_allow_html=True,
    )
    col1, col2 = container.columns(2)
    start = col1.date_input(
        "Desde",
        min_value=min_date,
        max_value=max_date,
        key=DATE_START_WIDGET_KEY,
        on_change=_sync_widget_dates,
    )
    end = col2.date_input(
        "Hasta",
        min_value=min_date,
        max_value=max_date,
        key=DATE_END_WIDGET_KEY,
        on_change=_sync_widget_dates,
    )

    if start > end:
        container.warning("La fecha inicial no puede ser mayor que la final.")
        return min_date, max_date

    st.session_state[DATE_START_KEY] = start
    st.session_state[DATE_END_KEY] = end
    container.markdown(
        f'<div class="bhd-range-badge">{start:%d/%m/%Y} - {end:%d/%m/%Y}</div>',
        unsafe_allow_html=True,
    )

    if container.button("Restablecer fechas", use_container_width=True):
        st.session_state[DATE_START_KEY] = min_date
        st.session_state[DATE_END_KEY] = max_date
        st.rerun()

    return start, end


def apply_date_filter(
    df: pd.DataFrame,
    start: date | None = None,
    end: date | None = None,
) -> pd.DataFrame:
    if df.empty:
        return df

    if start is None:
        start = st.session_state.get(DATE_START_KEY)
    if end is None:
        end = st.session_state.get(DATE_END_KEY)
    if start is None or end is None:
        return df

    fechas = pd.to_datetime(df["fecha"], format="%d/%m/%Y", errors="coerce")
    return df[(fechas >= pd.to_datetime(start)) & (fechas <= pd.to_datetime(end))].copy()
