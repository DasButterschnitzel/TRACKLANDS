// Monetization abstraction. The game never requires it: every call returns a
// safe development-mode result and ad/shop entry points stay hidden while
// `available()` is false. Future ethical options (cosmetics, supporter pack,
// optional rewarded bonuses) plug in here without touching gameplay code.
export const MonetizationService = {
  mode: 'development',
  available() { return false; },
  adsAvailable() { return false; },
  async requestRewardedAd(placement) {
    return { rewarded: false, dev: true, placement, reason: 'development_mode' };
  },
  async purchaseProduct(productId) {
    return { ok: false, dev: true, productId, reason: 'development_mode' };
  },
  async restorePurchases() {
    return { ok: true, dev: true, products: [] };
  },
  async openPremiumShop() {
    return { ok: false, dev: true, reason: 'development_mode' };
  },
  async purchaseCosmetic(cosmeticId) {
    return { ok: false, dev: true, cosmeticId, reason: 'development_mode' };
  },
};
