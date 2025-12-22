/**
 * Activity-based placeholder images for programs without images
 * Uses Unsplash CDN for reliable, fast image delivery
 */

const PLACEHOLDER_IMAGES = {
  // Winter/Snow activities
  ski: 'https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=400&h=300&fit=crop',
  snow: 'https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=400&h=300&fit=crop',
  winter: 'https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=400&h=300&fit=crop',
  
  // STEM/Robotics
  robot: 'https://images.unsplash.com/photo-1561557944-6e7860d1a7eb?w=400&h=300&fit=crop',
  stem: 'https://images.unsplash.com/photo-1561557944-6e7860d1a7eb?w=400&h=300&fit=crop',
  sensor: 'https://images.unsplash.com/photo-1561557944-6e7860d1a7eb?w=400&h=300&fit=crop',
  engineering: 'https://images.unsplash.com/photo-1561557944-6e7860d1a7eb?w=400&h=300&fit=crop',
  
  // Coding/Programming
  code: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=400&h=300&fit=crop',
  coding: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=400&h=300&fit=crop',
  programming: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=400&h=300&fit=crop',
  computer: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=400&h=300&fit=crop',
  
  // Ocean/Marine
  ocean: 'https://images.unsplash.com/photo-1583212292454-1fe6229603b7?w=400&h=300&fit=crop',
  marine: 'https://images.unsplash.com/photo-1583212292454-1fe6229603b7?w=400&h=300&fit=crop',
  aqua: 'https://images.unsplash.com/photo-1583212292454-1fe6229603b7?w=400&h=300&fit=crop',
  swim: 'https://images.unsplash.com/photo-1583212292454-1fe6229603b7?w=400&h=300&fit=crop',
  
  // Camping
  camp: 'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=400&h=300&fit=crop',
  outdoor: 'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=400&h=300&fit=crop',
  nature: 'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=400&h=300&fit=crop',
  
  // Art/Creative
  art: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&h=300&fit=crop',
  creative: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&h=300&fit=crop',
  paint: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&h=300&fit=crop',
  craft: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&h=300&fit=crop',
  
  // Music
  music: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=400&h=300&fit=crop',
  instrument: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=400&h=300&fit=crop',
  
  // Sports
  sport: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&h=300&fit=crop',
  soccer: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&h=300&fit=crop',
  basketball: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&h=300&fit=crop',
  tennis: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&h=300&fit=crop',
};

const DEFAULT_PLACEHOLDER = 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&h=300&fit=crop';

/**
 * Get an appropriate placeholder image URL based on program title and category
 */
export function getPlaceholderImage(title: string, category?: string): string {
  const searchText = `${title} ${category || ''}`.toLowerCase();
  
  for (const [keyword, imageUrl] of Object.entries(PLACEHOLDER_IMAGES)) {
    if (searchText.includes(keyword)) {
      return imageUrl;
    }
  }
  
  return DEFAULT_PLACEHOLDER;
}

/**
 * Ensure a program has an image URL, using placeholder as fallback
 */
export function ensureImageUrl(
  existingUrl: string | null | undefined,
  title: string,
  category?: string
): string {
  if (existingUrl && existingUrl.trim()) {
    return existingUrl;
  }
  return getPlaceholderImage(title, category);
}
