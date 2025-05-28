import PushToken from '../models/notifications.model.js';
import axios from 'axios';

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
const chunkArray = (array, size) => {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
};

export const sendPushNotification = async (req, res) => {
  const { title, body } = req.body;

  if (!title || !body) {
    return res.status(400).json({ error: 'Title and body are required' });
  }

  try {
    // احصل على كل التوكنات
    const tokens = await PushToken.find().select('token -_id');
    if (!tokens.length) {
      return res.status(200).json({ message: 'No tokens to send notifications to' });
    }

    // جهّز الرسائل
    const messages = tokens.map((t) => ({
      to: t.token,
      sound: 'default',
      title,
      body,
    }));

    // قسّم الرسائل إلى دفعات (Expo يوصي بحد أقصى 100 لكل دفعة)
    const chunks = chunkArray(messages, 100);
    const results = [];

    for (const chunk of chunks) {
      const response = await axios.post('https://exp.host/--/api/v2/push/send', chunk, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });
      results.push(response.data);
    }

    return res.status(200).json({ message: 'Notifications sent', results });
  } catch (error) {
    console.error('❌ Error sending push notifications:', error);
    return res.status(500).json({ error: 'Failed to send notifications' });
  }
};
