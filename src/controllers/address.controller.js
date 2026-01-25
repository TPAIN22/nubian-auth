import Address from '../models/address.model.js';
import Country from '../models/country.model.js';
import City from '../models/city.model.js';
import SubCity from '../models/subcity.model.js';
import { getAuth } from '@clerk/express';
import User from '../models/user.model.js';

// Helper function to denormalize location names for display
const denormalizeLocationNames = async (addressData) => {
  try {
    if (addressData.countryId) {
      const country = await Country.findById(addressData.countryId).select('nameAr nameEn');
      if (country) {
        addressData.countryName = country.nameEn; // Default to English, can be localized later
      }
    }

    if (addressData.cityId) {
      const city = await City.findById(addressData.cityId).select('nameAr nameEn');
      if (city) {
        addressData.cityName = city.nameEn;
      }
    }

    if (addressData.subCityId) {
      const subCity = await SubCity.findById(addressData.subCityId).select('nameAr nameEn');
      if (subCity) {
        addressData.subCityName = subCity.nameEn;
      }
    }
  } catch (error) {
    // Log error but don't fail the address creation/update
    console.warn('Failed to denormalize location names:', error.message);
  }
};

export const getAddresses = async (req, res) => {
  const { userId } = getAuth(req);
  try {
    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    const addresses = await Address.find({ user: user._id });
    res.status(200).json(addresses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const addAddress = async (req, res) => {
  const { userId } = getAuth(req);
  try {
    const user = await User.findOne({ clerkId: userId });
    if (req.body.isDefault) {
      await Address.updateMany({ user: user._id }, { isDefault: false });
    }

    // Handle new location fields and denormalize names if needed
    const addressData = { ...req.body, user: user._id };

    // If location IDs are provided, denormalize the names for display
    if (addressData.countryId || addressData.cityId || addressData.subCityId) {
      await denormalizeLocationNames(addressData);
    }

    const address = await Address.create(addressData);
    res.status(201).json(address);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateAddress = async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = req.params;
  try {
    const user = await User.findOne({ clerkId: userId });
    if (req.body.isDefault) {
      await Address.updateMany({ user: user._id }, { isDefault: false });
    }

    // Handle new location fields and denormalize names if needed
    const addressData = { ...req.body, user: user._id };

    // If location IDs are provided, denormalize the names for display
    if (addressData.countryId || addressData.cityId || addressData.subCityId) {
      await denormalizeLocationNames(addressData);
    }

    const address = await Address.findOneAndUpdate(
      { _id: id, user: user._id },
      addressData,
      { new: true }
    );
    res.status(200).json(address);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteAddress = async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = req.params;
  try {
    
    const user = await User.findOne({ clerkId: userId });
    await Address.findOneAndDelete({ _id: id, user: user._id });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const setDefaultAddress = async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = req.params;
  try {
    const user = await User.findOne({ clerkId: userId });

    await Address.updateMany({ user: user._id }, { isDefault: false });
    const address = await Address.findOneAndUpdate({ _id: id, user: user._id }, { isDefault: true }, { new: true });
    res.status(200).json(address);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}; 