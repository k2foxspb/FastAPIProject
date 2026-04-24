"""
SEO-роутер: robots.txt, sitemap.xml, JSON-LD микроразметка товаров,
PWA manifest, Android App Links (assetlinks.json), Apple Universal Links.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_async_db
from app.models.products import Product as ProductModel
from app.models.categories import Category as CategoryModel
from app.core.config import DOMAIN

router = APIRouter(tags=["seo"])

SITE_NAME = "FokinFun"
ANDROID_PACKAGE = "com.k2foxspb.fokinfun"
IOS_BUNDLE = "com.k2foxspb.fokinfun"
# Замените на реальный Team ID из Apple Developer Console
APPLE_TEAM_ID = "XXXXXXXXXX"


# ---------------------------------------------------------------------------
# robots.txt
# ---------------------------------------------------------------------------
@router.get("/robots.txt", include_in_schema=False)
async def robots_txt():
    content = f"""User-agent: *
Allow: /
Disallow: /api/
Disallow: /docs
Disallow: /redoc
Disallow: /admin/
Disallow: /ws-test
Disallow: /chat-test
Crawl-delay: 1

Sitemap: {DOMAIN}/sitemap.xml
"""
    return Response(content=content, media_type="text/plain")


# ---------------------------------------------------------------------------
# sitemap.xml — статические страницы + все активные товары из БД
# ---------------------------------------------------------------------------
@router.get("/sitemap.xml", include_in_schema=False)
async def sitemap_xml(db: AsyncSession = Depends(get_async_db)):
    static_urls = [
        ("", "1.0", "daily"),
        ("/privacy-policy", "0.5", "monthly"),
        ("/terms", "0.5", "monthly"),
    ]

    result_products = await db.execute(
        select(ProductModel.id, ProductModel.updated_at)
        .where(ProductModel.is_active == True, ProductModel.moderation_status == "approved")
        .order_by(ProductModel.id)
    )
    products = result_products.fetchall()

    result_cats = await db.execute(
        select(CategoryModel.id, CategoryModel.name)
        .order_by(CategoryModel.id)
    )
    categories = result_cats.fetchall()

    today = datetime.utcnow().strftime("%Y-%m-%d")

    urls_xml = ""
    for path, priority, changefreq in static_urls:
        urls_xml += f"""  <url>
    <loc>{DOMAIN}{path}</loc>
    <changefreq>{changefreq}</changefreq>
    <priority>{priority}</priority>
    <lastmod>{today}</lastmod>
  </url>\n"""

    for cat_id, _ in categories:
        urls_xml += f"""  <url>
    <loc>{DOMAIN}/categories/{cat_id}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
    <lastmod>{today}</lastmod>
  </url>\n"""

    for product_id, updated_at in products:
        lastmod = updated_at.strftime("%Y-%m-%d") if updated_at else today
        urls_xml += f"""  <url>
    <loc>{DOMAIN}/products/{product_id}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
    <lastmod>{lastmod}</lastmod>
  </url>\n"""

    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{urls_xml}</urlset>"""
    return Response(content=xml, media_type="application/xml")


# ---------------------------------------------------------------------------
# JSON-LD микроразметка товара (Schema.org Product)
# Используется фронтендом/SSR: GET /products/{product_id}/jsonld
# ---------------------------------------------------------------------------
@router.get("/products/{product_id}/jsonld", include_in_schema=True, summary="Schema.org JSON-LD для товара")
async def product_jsonld(product_id: int, db: AsyncSession = Depends(get_async_db)):
    result = await db.execute(
        select(ProductModel).where(ProductModel.id == product_id, ProductModel.is_active == True)
    )
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    availability = "https://schema.org/InStock" if product.stock > 0 else "https://schema.org/OutOfStock"

    jsonld = {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": product.name,
        "description": product.description or "",
        "url": f"{DOMAIN}/products/{product.id}",
        "offers": {
            "@type": "Offer",
            "priceCurrency": "RUB",
            "price": str(product.price),
            "availability": availability,
            "url": f"{DOMAIN}/products/{product.id}",
            "seller": {
                "@type": "Organization",
                "name": SITE_NAME
            }
        },
    }

    if product.image_url:
        jsonld["image"] = product.image_url if product.image_url.startswith("http") else f"{DOMAIN}{product.image_url}"

    if product.rating:
        jsonld["aggregateRating"] = {
            "@type": "AggregateRating",
            "ratingValue": str(round(product.rating, 1)),
            "bestRating": "5",
            "worstRating": "1",
        }

    return JSONResponse(content=jsonld, media_type="application/ld+json")


# ---------------------------------------------------------------------------
# PWA Web App Manifest
# ---------------------------------------------------------------------------
@router.get("/manifest.json", include_in_schema=False)
async def web_manifest():
    manifest = {
        "name": SITE_NAME,
        "short_name": SITE_NAME,
        "description": "Интернет-магазин FokinFun",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#ffffff",
        "theme_color": "#2196F3",
        "lang": "ru",
        "icons": [
            {
                "src": "/media/app/icon-192.png",
                "sizes": "192x192",
                "type": "image/png",
                "purpose": "any maskable"
            },
            {
                "src": "/media/app/icon-512.png",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "any maskable"
            }
        ],
        "related_applications": [
            {
                "platform": "play",
                "url": f"https://play.google.com/store/apps/details?id={ANDROID_PACKAGE}",
                "id": ANDROID_PACKAGE
            },
            {
                "platform": "itunes",
                "url": f"https://apps.apple.com/app/{IOS_BUNDLE}"
            }
        ],
        "prefer_related_applications": False
    }
    return JSONResponse(content=manifest, media_type="application/manifest+json")


# ---------------------------------------------------------------------------
# Android App Links — Digital Asset Links
# Позволяет Google индексировать deep links в приложении
# ---------------------------------------------------------------------------
@router.get("/.well-known/assetlinks.json", include_in_schema=False)
async def asset_links():
    data = [
        {
            "relation": ["delegate_permission/common.handle_all_urls"],
            "target": {
                "namespace": "android_app",
                "package_name": ANDROID_PACKAGE,
                "sha256_cert_fingerprints": [
                    # TODO: замените на реальный SHA-256 fingerprint вашего release keystore
                    # Получить: keytool -list -v -keystore release.keystore
                    "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99"
                ]
            }
        }
    ]
    return JSONResponse(content=data, media_type="application/json")


# ---------------------------------------------------------------------------
# Apple Universal Links — Apple App Site Association
# ---------------------------------------------------------------------------
@router.get("/.well-known/apple-app-site-association", include_in_schema=False)
async def apple_app_site_association():
    data = {
        "applinks": {
            "apps": [],
            "details": [
                {
                    "appID": f"{APPLE_TEAM_ID}.{IOS_BUNDLE}",
                    "paths": [
                        "/products/*",
                        "/categories/*",
                        "/"
                    ]
                }
            ]
        },
        "webcredentials": {
            "apps": [f"{APPLE_TEAM_ID}.{IOS_BUNDLE}"]
        }
    }
    return JSONResponse(content=data, media_type="application/json")
