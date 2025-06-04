import PushToken from '../models/notifications.model.js';
import Notify from '../models/notify.model.js';
import axios from 'axios';

const chunkArray = (array, size) => {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
};

// حفظ التوكن
export const savePushToken = async (req, res) => {
  const { token, platform, deviceId, userId } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Expo push token is required' });
  }

  try {
    const existing = await PushToken.findOne({ token });
    if (!existing) {
      await PushToken.create({
        token,
        platform,
        deviceId,
        userId: userId || null,
      });
    }

    return res.status(200).json({ message: 'Token saved successfully' });
  } catch (error) {
    console.error('❌ Error saving push token:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// حفظ الإشعار في قاعدة البيانات
export const saveNotification = async (req, res) => {
  const { title, body, userId, deviceId } = req.body;

  if (!title || !body || (!userId && !deviceId)) {
    return res.status(400).json({ error: 'title, body, and userId or deviceId are required' });
  }

  try {
    const notification = await Notify.create({
      title,
      body,
      userId: userId || null,
      deviceId: userId ? null : deviceId,
    });

    res.status(201).json({ message: 'Notification saved', notification });
  } catch (error) {
    console.error('❌ Error saving notification:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// إرسال إشعارات لجميع المستخدمين
export const sendPushNotification = async (req, res) => {
  const { title, body } = req.body;

  if (!title || !body) {
    return res.status(400).json({ error: 'Title and body are required' });
  }

  try {
    const tokens = await PushToken.find().select('token -_id');
    if (!tokens.length) {
      return res.status(200).json({ message: 'No tokens to send notifications to' });
    }

    const messages = tokens.map((t) => ({
      to: t.token,
      sound: 'default',
      title,
      body,
    }));

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

    // احفظ الإشعار في قاعدة البيانات كإشعار عام
    await Notify.create({
      title,
      body,
      userId: null,
      deviceId: null,
    });

    return res.status(200).json({ message: 'Notifications sent', results });
  } catch (error) {
    console.error('❌ Error sending push notifications:', error);
    return res.status(500).json({ error: 'Failed to send notifications' });
  }
};
