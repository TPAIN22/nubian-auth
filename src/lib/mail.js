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

/**
 * Send merchant suspension notification email
 * @param {Object} params
 * @param {string} params.to - Merchant email address
 * @param {string} params.businessName - Merchant business name
 * @param {string} params.suspensionReason - Reason for suspension
 * @param {Date} params.suspendedAt - Suspension date
 */
export async function sendMerchantSuspensionEmail({ to, businessName, suspensionReason, suspendedAt }) {
  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <h2 style="color: #856404; margin-top: 0;">⚠️ تم تعليق حسابك التجاري</h2>
      </div>
      
      <p>مرحباً <b>${businessName}</b>,</p>
      
      <p>نود إعلامك بأن حسابك التجاري قد تم تعليقه من قبل الإدارة.</p>
      
      <div style="background-color: #f8f9fa; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #856404;">سبب التعليق:</h3>
        <p style="margin-bottom: 0;">${suspensionReason}</p>
      </div>
      
      <p><strong>تاريخ التعليق:</strong> ${new Date(suspendedAt).toLocaleDateString('ar-SA', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })}</p>
      
      <div style="background-color: #e7f3ff; border-left: 4px solid #2196F3; padding: 15px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #1976D2;">ما الذي يعنيه هذا؟</h3>
        <ul>
          <li>لن تتمكن من إضافة أو تعديل المنتجات</li>
          <li>لن تتمكن من إدارة الطلبات</li>
          <li>سيتم إخفاء منتجاتك مؤقتاً من الموقع</li>
        </ul>
      </div>
      
      <p>إذا كان لديك أي استفسارات أو ترغب في مناقشة سبب التعليق، يرجى التواصل معنا.</p>
      
      <p>مع أطيب التحيات،<br>فريق نوبيان</p>
      
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
      <p style="color: #666; font-size: 12px;">هذه رسالة تلقائية، يرجى عدم الرد على هذا البريد الإلكتروني.</p>
    </div>
  `;
  
  try {
    return await resend.emails.send({
      from: 'Nubian <nubiang@nubian-sd.info>',
      to,
      subject: `تم تعليق حسابك التجاري - ${businessName}`,
      html,
    });
  } catch (error) {
    console.error('Error sending suspension email:', error);
    throw error;
  }
}

/**
 * Send merchant unsuspension notification email
 * @param {Object} params
 * @param {string} params.to - Merchant email address
 * @param {string} params.businessName - Merchant business name
 */
export async function sendMerchantUnsuspensionEmail({ to, businessName }) {
  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #d4edda; border: 1px solid #28a745; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <h2 style="color: #155724; margin-top: 0;">✅ تم إلغاء تعليق حسابك التجاري</h2>
      </div>
      
      <p>مرحباً <b>${businessName}</b>,</p>
      
      <p>نود إعلامك بأن تعليق حسابك التجاري قد تم إلغاؤه، ويمكنك الآن متابعة نشاطك التجاري بشكل طبيعي.</p>
      
      <div style="background-color: #e7f3ff; border-left: 4px solid #2196F3; padding: 15px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #1976D2;">يمكنك الآن:</h3>
        <ul>
          <li>إضافة وتعديل المنتجات</li>
          <li>إدارة الطلبات</li>
          <li>متابعة مبيعاتك</li>
        </ul>
      </div>
      
      <p>نشكرك على صبرك وتعاونك.</p>
      
      <p>مع أطيب التحيات،<br>فريق نوبيان</p>
      
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
      <p style="color: #666; font-size: 12px;">هذه رسالة تلقائية، يرجى عدم الرد على هذا البريد الإلكتروني.</p>
    </div>
  `;
  
  try {
    return await resend.emails.send({
      from: 'Nubian <nubiang@nubian-sd.info>',
      to,
      subject: `تم إلغاء تعليق حسابك التجاري - ${businessName}`,
      html,
    });
  } catch (error) {
    console.error('Error sending unsuspension email:', error);
    throw error;
  }
} 