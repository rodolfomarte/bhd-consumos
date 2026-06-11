CATEGORIAS: dict[str, list[str]] = {
    "Supermercado / Hogar": [
        "JUMBO", "BRAVO", "SIRENA", "PRICESMART", "PRICE SMART",
        "LA CADENA", "NACIONAL", "SUPER POLA",
    ],
    "Comida Rápida": [
        "MCDONALD", "LITTLE CAESARS", "BURGER", "KFC", "POLLO REY",
        "WENDY", "SUBWAY", "PIZZA HUT", "DOMINO", "TACO BELL",
    ],
    "Restaurantes": [
        "RESTAURANT", "FORNO", "CAFE", "CAFETERIA", "BAR ",
        "BISTRO", "GRILL", "COMEDOR", "MESÓN", "MESON",
    ],
    "Combustible / Transporte": [
        "SHELL", "TEXACO", "TOTAL", "ISLA", " GAS", "GASOLINA",
        "ESTACION", "COMBUSTIBLE", "GASOLINERA", "PUMA",
    ],
    "Farmacia / Salud": [
        "FARM", "CAROL", "PHARMACY", "CLINICA", "HOSPITAL",
        "MEDICA", "SALUD", "DROGUERIA", "BOTICA",
    ],
    "Cuidado Personal": [
        "SALON", "BARBER", "SPA", "PELUQUERIA", "BEAUTY",
        "NAIL", "ESTETICA",
    ],
    "Suscripciones Digitales": [
        "APPLE", "GOOGLE", "NETFLIX", "SPOTIFY", "MICROSOFT",
        "AMAZON PRIME", "YOUTUBE", "DISNEY", "HBO", "PARAMOUNT",
        "ADOBE", "DROPBOX",
    ],
}


def clasificar(comercio: str) -> str:
    comercio_upper = comercio.upper()
    for categoria, keywords in CATEGORIAS.items():
        for keyword in keywords:
            if keyword in comercio_upper:
                return categoria
    return "Otros"
