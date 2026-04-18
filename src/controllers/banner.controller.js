import Banner from '../models/banners.model.js';
import { invalidateHomeCache } from './home.controller.js';

export const getBanners = async (req, res) => {
  try {
    const banners = await Banner.find().sort({ order: 1, createdAt: -1 });
    res.status(200).json(banners);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createBanner = async (req, res) => {
  try {
    const banner = await Banner.create(req.body);
    invalidateHomeCache();
    res.status(201).json(banner);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateBanner = async (req, res) => {
  try {
    const banner = await Banner.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!banner) return res.status(404).json({ message: 'Banner not found' });
    invalidateHomeCache();
    res.status(200).json(banner);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteBanner = async (req, res) => {
  try {
    await Banner.findByIdAndDelete(req.params.id);
    invalidateHomeCache();
    res.status(200).json({ message: 'Banner deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}; 