/**
 * The provider used when no vendor is configured.
 *
 * It never throws and never invents data: reverse geocoding returns a
 * coordinate-only address, search returns nothing. That keeps the map-first flow
 * usable — a shopper can still drop a pin and type their building details — and
 * means a missing API key degrades the experience instead of taking checkout
 * down.
 */
import { GeoProvider } from '../GeoProvider.js';
import { GEO_ACCURACY, makeGeoAddress } from '../types.js';

export class NullGeoProvider extends GeoProvider {
  static get key() {
    return 'none';
  }

  get capabilities() {
    return {
      reverseGeocode: true,
      forwardGeocode: false,
      autocomplete: false,
      placeDetails: false,
      staticMap: false,
    };
  }

  isConfigured() {
    return true;
  }

  getClientConfig() {
    return {
      ...super.getClientConfig(),
      tileUrl: this.config.tileUrl || null,
      attribution: this.config.attribution || '',
    };
  }

  async reverseGeocode({ lat, lng }) {
    return makeGeoAddress({
      lat,
      lng,
      // A pin with no label is honest; the UI shows the coordinates and asks the
      // shopper to describe the place themselves.
      formattedAddress: '',
      provider: this.key,
      accuracy: GEO_ACCURACY.UNKNOWN,
    });
  }

  async forwardGeocode() {
    return null;
  }

  async autocomplete() {
    return [];
  }

  async placeDetails() {
    return null;
  }
}

export default NullGeoProvider;
