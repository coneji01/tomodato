# Proyecto GPON — 20 NAPs (FTTH Manager v2)

## Arquitectura General

```
OLT Central (Huawei MA5800-X17)
├── PON-1 (Puerto 1 — 12 fibras)
│   ├── Cable Troncal 12F → Manga Principal
│   │   ├── Splitter 1:16 en Manga Principal
│   │   ├── Fibra 1 → NAP-1 (Residencial A) ← 2 clientes activos ✅
│   │   ├── Fibra 2 → NAP-2 (Residencial B) ← 1 cliente activo ✅
│   │   ├── Fibra 3 → NAP-5 (Callejon)
│   │   ├── Fibra 4 → NAP-3 (Zona U)
│   │   ├── Fibra 5 → NAP-4 (Zona U)
│   │   ├── Fibra 6 → NAP-18 (Zona U Sur)
│   │   ├── Fibra 7 → NAP-19 (Zona U Este)
│   │   └── Fibra 8 → Cable-2 (515m → Manga-2)
│   │
│   └── Cable-2 12F (515m) → Manga-2
│       ├── Splitter 1:8 en Manga-2
│       ├── Fibra 1 → Cable-3 (380m) → NAP-6, NAP-7
│       │   ├── Splitter 1:8
│       │   ├── NAP-6 (2 puertos)
│       │   └── NAP-7 (2 puertos)
│       ├── Fibra 2 → Cable-4 (330m) → NAP-8, NAP-9
│       │   ├── Splitter 1:8
│       │   ├── NAP-8 (8 puertos)
│       │   └── NAP-9 (8 puertos)
│       ├── Fibra 3 → Cable-5 (116m) → NAP-15
│       ├── Fibra 4 → Cable-6 (202m) → NAP-16
│       ├── Fibra 5 → Cable-7 → NAP-7 (activo)
│       └── Fibra 8 → Cable-8 (1044m) → Manga-3
│           └── Splitter 1:8 en Manga-3
│               ├── NAP-10 (8 puertos)
│               ├── NAP-11 (8 puertos)
│               ├── NAP-14 (8 puertos)
│               ├── NAP-17 (8 puertos)
│               └── Cable-9 (571m) → Manga-4
│                   └── Splitter 1:8
│                       ├── NAP-12 (8 puertos)
│                       ├── NAP-13 (8 puertos)
│                       └── NAP-20 (8 puertos)

PON-2 (Puerto 2 — reserva futura)
```

## Presupuesto Óptico

### Fórmula: Potencia OLT - (Atenuación cable + Pérdida splitter + Pérdida empalmes + Margen)

| Parámetro | Valor |
|---|---|
| Potencia OLT | +2.5 dBm |
| Atenuación fibra | 0.35 dB/km |
| Splitter 1:8 | 10.5 dB |
| Splitter 1:16 | 13.8 dB |
| Empalme fusión | 0.1 dB c/u |
| Conector | 0.3 dB c/u |
| Margen seguridad | 1.0 dB |
| Sensibilidad ONU GPON | -27 dBm |

### Cálculos por ruta crítica:

**Ruta 1 (más larga): OLT → Manga Prin → Manga-2 → Manga-3 → Manga-4 → NAP-20**
- Longitud fibra: 0 + 515 + 1044 + 571 = 2,130m (~2.13 km)
- Atenuación cable: 2.13 × 0.35 = 0.75 dB
- Splitter 1:16 en Manga Principal: 13.8 dB
- Splitter 1:8 en Manga-2: 10.5 dB
- Splitter 1:8 en Manga-4: 10.5 dB
- Empalmes: 6 empalmes × 0.1 = 0.6 dB
- Conectores: 4 × 0.3 = 1.2 dB
- **Total pérdida: 0.75 + 13.8 + 10.5 + 10.5 + 0.6 + 1.2 + 1.0 = 38.35 dB** ❌ Excede sensibilidad

⚠️ **Problema: splitter en cascada.** Para mantener presupuesto óptico, en lugar de splitter 1:8 en Manga-4, usar paso directo.
O mejor: separar en PON separados.

**Solución:**
- PON-1 → Splitter 1:16 en Manga Principal → NAPs locales + feeder a Manga-2
- PON-2 → Splitter 1:16 con feeder directo a zona norte

### Plan corregido (presupuesto óptico válido):

**PON-1 (Puerto 1 OLT):**
OLT (+2.5 dBm) → 12F cable (0.5 dB/km) → Splitter 1:16 (13.8 dB) → a NAPs con max 3.7 km

| Ruta | Distancia | Aten. cable | Splitter | Empalmes | Conectores | Margen | Total pérdida | Potencia final | ¿OK? |
|------|-----------|-------------|----------|-----------|------------|--------|--------------|---------------|------|
| OLT→NAP-1 | 1.2km | 0.42dB | 13.8dB | 0.2dB | 0.6dB | 1dB | **16.02dB** | **-13.52dBm** | ✅ |
| OLT→NAP-2 | 1.5km | 0.53dB | 13.8dB | 0.2dB | 0.6dB | 1dB | **16.13dB** | **-13.63dBm** | ✅ |
| OLT→NAPs 3-5 (Zona U) | 0.8km | 0.28dB | + Splitter 1:8 o directo | — | — | — | **~15dB** | **~-12.5dBm** | ✅ |
| OLT→Manga-2→NAPs 8-10 | 515m+~1km | 0.53dB | + Splitter 1:8 | 0.3dB | 0.9dB | 1dB | **~22dB** | **~-19.5dBm** | ✅ |

## Acciones a ejecutar

### 1. Agregar 6 NAPs nuevas (15-20)
### 2. Actualizar splitters en NAPs existentes (GPON standard)
### 3. Crear manga splitters para distribución
### 4. Crear conexiones de fibra completas
### 5. Calcular y verificar presupuesto óptico
### 6. Iniciar servidor para visualización
