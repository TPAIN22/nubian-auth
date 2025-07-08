import Address from '../models/address.model.js';
import { getAuth } from '@clerk/express';

export const getAddresses = async (req, res) => {
  const { userId } = getAuth(req);
  try {
    const addresses = await Address.find({ user: userId });
    res.status(200).json(addresses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const addAddress = async (req, res) => {
  const { userId } = getAuth(req);
  try {
    if (req.body.isDefault) {
      await Address.updateMany({ user: userId }, { isDefault: false });
    }
    const address = await Address.create({ ...req.body, user: userId });
    res.status(201).json(address);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateAddress = async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = req.params;
  try {
    if (req.body.isDefault) {
      await Address.updateMany({ user: userId }, { isDefault: false });
    }
    const address = await Address.findOneAndUpdate({ _id: id, user: userId }, req.body, { new: true });
    res.status(200).json(address);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteAddress = async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = req.params;
  try {
    await Address.findOneAndDelete({ _id: id, user: userId });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const setDefaultAddress = async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = req.params;
  try {
    await Address.updateMany({ user: userId }, { isDefault: false });
    const address = await Address.findOneAndUpdate({ _id: id, user: userId }, { isDefault: true }, { new: true });
    res.status(200).json(address);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}; 