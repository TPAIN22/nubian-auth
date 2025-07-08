import Address from '../models/address.model.js';
import { getAuth } from '@clerk/express';
import User from '../models/user.model.js';

export const getAddresses = async (req, res) => {
  const { userId } = getAuth(req);
  try {
    const user = await User.findOne({ clerkId: userId });
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
    const address = await Address.create({ ...req.body, user: user._id });
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
    const address = await Address.findOneAndUpdate({ _id: id, user: user._id }, req.body, { new: true });
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

    await Address.updateMany({ user: userId }, { isDefault: false });
    const address = await Address.findOneAndUpdate({ _id: id, user: user._id }, { isDefault: true }, { new: true });
    res.status(200).json(address);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}; 