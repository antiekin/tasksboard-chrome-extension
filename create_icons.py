#!/usr/bin/env python3
"""
Create simple placeholder icons for the Chrome extension
Requires PIL (Pillow): pip3 install Pillow
"""

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Error: Pillow is not installed.")
    print("Please run: pip3 install Pillow")
    exit(1)

def create_icon(size, filename):
    """Create a simple checkmark icon"""
    # Create image with rounded square background
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background - rounded rectangle (Google blue)
    margin = size // 10
    draw.rounded_rectangle(
        [(margin, margin), (size - margin, size - margin)],
        radius=size // 6,
        fill=(66, 133, 244, 255)  # Google Blue #4285F4
    )

    # Draw checkmark
    stroke_width = max(2, size // 16)

    # Checkmark coordinates (scaled to icon size)
    scale = size / 48.0
    points = [
        (14 * scale, 24 * scale),
        (20 * scale, 30 * scale),
        (34 * scale, 16 * scale)
    ]

    # Draw checkmark as thick white line
    draw.line(
        [points[0], points[1], points[2]],
        fill='white',
        width=stroke_width,
        joint='curve'
    )

    img.save(filename)
    print(f"Created {filename}")

# Create all required icon sizes
sizes = [16, 32, 48, 128]
for size in sizes:
    create_icon(size, f'icons/icon{size}.png')

print("\nAll icons created successfully!")
print("You can replace these with custom icons later.")
