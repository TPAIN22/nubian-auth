import { Resend } from 'resend';
import dotenv from "dotenv"
dotenv.config()
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Send welcome email to newly registered user
 * @param {Object} params
 * @param {string} params.to - User email address
 * @param {string} params.userName - User's first name or full name
 */
export async function sendWelcomeEmail({ to, userName }) {
  const currentYear = new Date().getFullYear();
  const appName = 'Nubian';
  const appUrl = 'https://nubian-sd.info';
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Welcome to ${appName}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #faf9f7; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;">
  
  <!-- Email Wrapper -->
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #faf9f7;">
    <tr>
      <td align="center" style="padding: 48px 20px;">
        
        <!-- Email Container -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px; background-color: #ffffff; border-radius: 20px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);">
          
          <!-- Header -->
          <tr>
            <td align="center" style="padding: 52px 40px 28px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background: linear-gradient(135deg, #d97706 0%, #f59e0b 100%); color: #ffffff; font-size: 22px; font-weight: 700; padding: 14px 28px; border-radius: 14px; letter-spacing: -0.5px;">
                    ${appName}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Welcome Headline -->
          <tr>
            <td align="center" style="padding: 0 40px 12px 40px;">
              <h1 style="margin: 0; font-size: 32px; font-weight: 700; color: #18181b; line-height: 1.25; letter-spacing: -0.75px;">
                Hey ${userName}, welcome! 🎉
              </h1>
            </td>
          </tr>
          
          <!-- Welcome Subheadline -->
          <tr>
            <td align="center" style="padding: 0 40px 28px 40px;">
              <p style="margin: 0; font-size: 17px; line-height: 1.65; color: #52525b; text-align: center;">
                We're so glad you're here. Your journey to discovering amazing products starts now.
              </p>
            </td>
          </tr>
          
          <!-- Feature Highlights -->
          <tr>
            <td style="padding: 0 40px 36px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #fefce8; border-radius: 16px; border: 1px solid #fef08a;">
                <tr>
                  <td style="padding: 24px 28px;">
                    <!-- Feature 1 -->
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 16px;">
                      <tr>
                        <td width="36" valign="top" style="padding-right: 14px;">
                          <div style="width: 32px; height: 32px; background-color: #fef3c7; border-radius: 8px; text-align: center; line-height: 32px; font-size: 16px;">✨</div>
                        </td>
                        <td valign="middle">
                          <p style="margin: 0; font-size: 15px; font-weight: 600; color: #18181b; line-height: 1.4;">Curated Collections</p>
                          <p style="margin: 4px 0 0 0; font-size: 14px; color: #71717a; line-height: 1.45;">Handpicked products just for you</p>
                        </td>
                      </tr>
                    </table>
                    <!-- Feature 2 -->
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 16px;">
                      <tr>
                        <td width="36" valign="top" style="padding-right: 14px;">
                          <div style="width: 32px; height: 32px; background-color: #fef3c7; border-radius: 8px; text-align: center; line-height: 32px; font-size: 16px;">🚀</div>
                        </td>
                        <td valign="middle">
                          <p style="margin: 0; font-size: 15px; font-weight: 600; color: #18181b; line-height: 1.4;">Fast & Reliable</p>
                          <p style="margin: 4px 0 0 0; font-size: 14px; color: #71717a; line-height: 1.45;">Quick checkout, speedy delivery</p>
                        </td>
                      </tr>
                    </table>
                    <!-- Feature 3 -->
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td width="36" valign="top" style="padding-right: 14px;">
                          <div style="width: 32px; height: 32px; background-color: #fef3c7; border-radius: 8px; text-align: center; line-height: 32px; font-size: 16px;">💬</div>
                        </td>
                        <td valign="middle">
                          <p style="margin: 0; font-size: 15px; font-weight: 600; color: #18181b; line-height: 1.4;">We're Here For You</p>
                          <p style="margin: 4px 0 0 0; font-size: 14px; color: #71717a; line-height: 1.45;">Friendly support whenever you need</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- CTA Button -->
          <tr>
            <td align="center" style="padding: 0 40px 44px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius: 14px; background: linear-gradient(135deg, #d97706 0%, #f59e0b 100%); box-shadow: 0 4px 14px rgba(217, 119, 6, 0.35);">
                    <a href="${appUrl}" target="_blank" style="display: inline-block; padding: 18px 48px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 14px; letter-spacing: -0.25px;">
                      Start Exploring →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Divider -->
          <tr>
            <td style="padding: 0 48px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="border-top: 1px solid #e4e4e7;"></td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Support Text -->
          <tr>
            <td align="center" style="padding: 32px 40px 44px 40px;">
              <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #71717a; text-align: center;">
                Questions? Just hit reply — a real human will get back to you.
              </p>
            </td>
          </tr>
          
        </table>
        <!-- End Email Container -->
        
        <!-- Footer -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px;">
          <tr>
            <td align="center" style="padding: 36px 40px 0 40px;">
              <p style="margin: 0 0 6px 0; font-size: 13px; color: #a1a1aa; text-align: center;">
                © ${currentYear} ${appName}. Made with care.
              </p>
              <p style="margin: 0; font-size: 12px; color: #d4d4d8; text-align: center;">
                You received this because you signed up for ${appName}.
              </p>
            </td>
          </tr>
        </table>
        
      </td>
    </tr>
  </table>
  <!-- End Email Wrapper -->
  
</body>
</html>`;

  try {
    return await resend.emails.send({
      from: 'Nubian <nubiang@nubian-sd.info>',
      to,
      subject: `Welcome to Nubian, ${userName}! 🎉`,
      html,
    });
  } catch (error) {
    console.error('Error sending welcome email:', error);
    throw error;
  }
}

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