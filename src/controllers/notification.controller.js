import PushToken from '../models/PushToken.js';

export const savePushToken = async (req, res) => {
  const { token, platform, deviceId } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Expo push token is required' });
  }

  try {
    const existing = await PushToken.findOne({ token });
    if (!existing) {
      await PushToken.create({ token, platform, deviceId });
    }

    return res.status(200).json({ message: 'Token saved successfully' });
  } catch (error) {
    console.error('Error saving push token:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
