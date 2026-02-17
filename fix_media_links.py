
import asyncio
import os
from sqlalchemy import select
from app.database import async_session_maker
from app.models.users import User, UserPhoto
from app.models.products import Product, ProductImage

# Setup paths (similar to users.py)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MEDIA_ROOT = os.getenv("MEDIA_ROOT", os.path.join(BASE_DIR, "media"))

def check_file_exists(url):
    if not url:
        return False
    # url is like /media/users/filename.jpeg or /media/products/filename.jpeg
    if url.startswith("/media/"):
        relative_path = url[len("/media/"):]
        file_path = os.path.join(MEDIA_ROOT, relative_path)
        return os.path.exists(file_path)
    return False

async def fix_broken_links():
    async with async_session_maker() as session:
        # 1. Fix User avatars
        print("Checking user avatars...")
        result = await session.execute(select(User).where(User.avatar_preview_url.isnot(None)))
        users = result.scalars().all()
        user_fixes = 0
        for user in users:
            if user.avatar_preview_url and user.avatar_preview_url != user.avatar_url:
                if not check_file_exists(user.avatar_preview_url):
                    print(f"Fixing avatar for user {user.email}: {user.avatar_preview_url} -> {user.avatar_url}")
                    user.avatar_preview_url = user.avatar_url
                    user_fixes += 1
        
        # 2. Fix UserPhotos
        print("Checking user photos...")
        result = await session.execute(select(UserPhoto))
        photos = result.scalars().all()
        photo_fixes = 0
        for photo in photos:
            if photo.preview_url and photo.preview_url != photo.image_url:
                if not check_file_exists(photo.preview_url):
                    print(f"Fixing photo preview {photo.id}: {photo.preview_url} -> {photo.image_url}")
                    photo.preview_url = photo.image_url
                    photo_fixes += 1

        # 3. Fix Products
        print("Checking products...")
        result = await session.execute(select(Product))
        products = result.scalars().all()
        product_fixes = 0
        for product in products:
            if product.thumbnail_url and product.thumbnail_url != product.image_url:
                if not check_file_exists(product.thumbnail_url):
                    print(f"Fixing product thumbnail {product.id}: {product.thumbnail_url} -> {product.image_url}")
                    product.thumbnail_url = product.image_url
                    product_fixes += 1

        # 4. Fix ProductImages
        print("Checking product images...")
        result = await session.execute(select(ProductImage))
        prod_images = result.scalars().all()
        prod_image_fixes = 0
        for img in prod_images:
            if img.thumbnail_url and img.thumbnail_url != img.image_url:
                if not check_file_exists(img.thumbnail_url):
                    print(f"Fixing product image thumbnail {img.id}: {img.thumbnail_url} -> {img.image_url}")
                    img.thumbnail_url = img.image_url
                    prod_image_fixes += 1
        
        total_fixes = user_fixes + photo_fixes + product_fixes + prod_image_fixes
        if total_fixes > 0:
            await session.commit()
            print(f"Committed {total_fixes} total fixes.")
            print(f"- User avatars: {user_fixes}")
            print(f"- User photos: {photo_fixes}")
            print(f"- Product thumbnails: {product_fixes}")
            print(f"- Product image thumbnails: {prod_image_fixes}")
        else:
            print("No broken links found.")

if __name__ == "__main__":
    print(f"Using MEDIA_ROOT: {MEDIA_ROOT}")
    asyncio.run(fix_broken_links())
