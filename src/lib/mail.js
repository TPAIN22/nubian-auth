import { Resend } from 'resend';
import dotenv from "dotenv"
dotenv.config()
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Send order confirmation or update email to user
 * @param {Object} params
 * @param {string} params.to - User email address
 * @param {string} params.userName - User full name
 * @param {string} params.orderNumber - Order number
 * @param {string} params.status - Order status
 * @param {number} params.totalAmount - Total order amount
 * @param {Array} params.products - Array of products {name, quantity, price}
 */
export async function sendOrderEmail({ to, userName, orderNumber, status, totalAmount, products }) {
  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif;">
      <h2>مرحباً ${userName} 👋</h2>
      <p>تم إنشاء طلبك بنجاح!</p>
      <p>رقم الطلب: <b>${orderNumber}</b></p>
      <p>الحالة: <b>${status}</b></p>
      <p>المبلغ الإجمالي: <b>${totalAmount.toLocaleString()} جنيه</b></p>
      <h3>تفاصيل المنتجات:</h3>
      <ul>
        ${products.map(p => `<li>${p.name} × ${p.quantity} - ${p.price.toLocaleString()} جنيه</li>`).join('')}
      </ul>
      <p>شكراً لثقتك بنا!</p>
    </div>
  `;
  return resend.emails.send({
    from: 'Nubian <nubiang@nubian-sd.info>',
    to,
    subject: `تم إنشاء طلبك رقم #${orderNumber}`,
    html,
  });
} 