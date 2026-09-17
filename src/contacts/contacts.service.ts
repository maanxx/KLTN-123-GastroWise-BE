import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Contact, ContactDocument, ContactTopic } from './schemas/contact.schema';
import { CreateContactDto } from './dto/create-contact.dto';

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    @InjectModel(Contact.name) private contactModel: Model<ContactDocument>,
    private configService: ConfigService,
  ) {}

  // Mapping hiển thị Tiếng Việt cho Topic
  private getTopicText(topic: string): string {
    switch (topic) {
      case ContactTopic.MERCHANT:
        return '🏪 Đăng ký Hợp tác Nhà hàng Mới';
      case ContactTopic.COMPLAINT:
        return '⚠️ Khiếu nại & Báo lỗi Dịch vụ';
      case ContactTopic.FEEDBACK:
        return '📩 Góp ý Chất lượng Dịch vụ';
      default:
        return '💬 Thắc mắc & Yêu cầu khác';
    }
  }

  // Phân loại tự động bằng Gemini AI (hoặc Rule-based)
  private async classifyWithAI(topic: string, message: string): Promise<string> {
    try {
      const apiKey = this.configService.get<string>('GEMINI_API_KEY');
      if (apiKey && apiKey !== 'your_gemini_api_key_here') {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const prompt = `Bạn là hệ thống AI phân loại phản hồi khách hàng cho nền tảng nhà hàng GastroWise. 
Hãy phân loại ngắn gọn (tối đa 5-8 từ) thông điệp sau đây thành một nhãn phân loại (Ví dụ: "Hợp tác B2B Khẩn", "Khiếu nại Thái độ", "Góp ý Giao diện", "Spam"):
Topic: ${topic}
Message: ${message}`;

        const result = await model.generateContent(prompt);
        const text = result?.response?.text()?.trim();
        if (text) return text;
      }
    } catch (err) {
      this.logger.warn(`AI classification fallback: ${err.message}`);
    }

    // Fallback nếu không gọi AI
    if (topic === ContactTopic.MERCHANT) return '🏪 Yêu cầu Hợp tác B2B (Độ ưu tiên cao)';
    if (topic === ContactTopic.COMPLAINT) return '⚠️ Khiếu nại Khẩn cấp';
    return '📩 Góp ý / Phản hồi Thông thường';
  }

  // Gửi dữ liệu ngầm sang Google Sheet Webhook
  private async syncToGoogleSheet(data: {
    name: string;
    phone: string;
    email: string;
    topicText: string;
    message: string;
    aiClassification: string;
  }) {
    const webhookUrl = this.configService.get<string>('GOOGLE_SHEET_WEBHOOK_URL');
    if (!webhookUrl || webhookUrl.trim() === '' || webhookUrl.includes('your_google_sheet')) {
      this.logger.log('ℹ️ GOOGLE_SHEET_WEBHOOK_URL chưa được cấu hình. Bỏ qua đồng bộ Google Sheet.');
      return;
    }

    try {
      const axios = require('axios');
      const payload = {
        ...data,
        status: 'CHỜ XỬ LÝ',
      };

      // Gửi dạng text/plain để Google Apps Script nhận dữ liệu qua 302 redirect mà không bị mất body
      const response = await axios.post(webhookUrl, JSON.stringify(payload), {
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        maxRedirects: 5,
      });

      this.logger.log(`📊 [GOOGLE SHEET SYNCED] Status: ${response.status}`);
    } catch (err) {
      this.logger.error(`❌ Error syncing to Google Sheet Webhook: ${err.message}`);
    }
  }

  // Gửi Email Phản Hồi Tự Động cho Khách hàng
  private async sendAutoReplyEmail(email: string, name: string, topicText: string) {
    try {
      const nodemailer = require('nodemailer');
      const smtpHost = this.configService.get<string>('SMTP_HOST') || 'smtp.gmail.com';
      const smtpPort = parseInt(this.configService.get<string>('SMTP_PORT') || '587', 10);
      const smtpUser = this.configService.get<string>('SMTP_USER');
      const smtpPass = this.configService.get<string>('SMTP_PASS');

      const mailContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; rounded-radius: 12px; background-color: #ffffff;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h1 style="color: #059669; margin: 0;">GastroWise Việt Nam</h1>
            <p style="color: #64748b; font-size: 14px;">Hệ thống Tìm kiếm & Đặt bàn Nhà hàng Thông minh</p>
          </div>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="font-size: 16px; color: #1e293b;">Xin chào <strong>${name}</strong>,</p>
          <p style="font-size: 15px; color: #334155; line-height: 1.6;">
            Cảm ơn bạn đã liên hệ với GastroWise về chủ đề: <strong>${topicText}</strong>.
          </p>
          <p style="font-size: 15px; color: #334155; line-height: 1.6;">
            Hệ thống của chúng tôi đã ghi nhận thông tin và chuyển đến Bộ phận Chăm sóc Khách hàng / Hợp tác Đối tác. Đội ngũ GastroWise sẽ xem xét và phản hồi trực tiếp tới bạn trong vòng <strong>24 giờ làm việc</strong>.
          </p>
          <div style="background-color: #f8fafc; padding: 15px; border-left: 4px solid #10b981; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 0; font-size: 14px; color: #475569;">
              Hotline hỗ trợ khẩn cấp: <strong>(+84) 379767728</strong><br/>
              Email: <strong>thanhoangthienthien@gmail.com</strong>
            </p>
          </div>
          <p style="font-size: 14px; color: #94a3b8; text-align: center; margin-top: 30px;">
            © 2026 GastroWise Việt Nam. All rights reserved.
          </p>
        </div>
      `;

      if (smtpUser && smtpPass) {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: { user: smtpUser, pass: smtpPass },
        });

        await transporter.sendMail({
          from: `"GastroWise Support" <${smtpUser}>`,
          to: email,
          subject: '[GastroWise] Xác nhận đã nhận được thông tin liên hệ của bạn',
          html: mailContent,
        });
        this.logger.log(`✉️ [AUTO-REPLY EMAIL SENT VIA SMTP] to ${email}`);
      } else {
        this.logger.log(`✉️ [AUTO-REPLY EMAIL LOGGED] (Chưa cấu hình SMTP) to ${email}`);
      }
    } catch (err) {
      this.logger.error(`❌ Lỗi khi gửi Auto-Reply Email: ${err.message}`);
    }
  }

  // TẠO LIÊN HỆ MỚI
  async createContact(createContactDto: CreateContactDto) {
    const { name, phone, email, topic, message } = createContactDto;
    const topicText = this.getTopicText(topic);

    // 1. Phân loại bằng AI
    const aiClassification = await this.classifyWithAI(topicText, message);

    // 2. Lưu DB MongoDB
    const createdContact = new this.contactModel({
      name,
      phone,
      email,
      topic,
      message,
      aiClassification,
      status: 'CHỜ XỬ LÝ',
    });
    const savedContact = await createdContact.save();

    // 3. Đẩy dữ liệu ngầm sang Google Sheet Webhook (Async)
    this.syncToGoogleSheet({
      name,
      phone,
      email,
      topicText,
      message,
      aiClassification,
    });

    // 4. Gửi Email Auto-Reply ngầm (Async)
    this.sendAutoReplyEmail(email, name, topicText);

    return {
      message: 'Cảm ơn bạn đã liên hệ! GastroWise đã nhận được thông tin và sẽ phản hồi sớm nhất.',
      data: savedContact,
    };
  }

  // TÌM TẤT CẢ LIÊN HỆ (Cho Admin Dashboard)
  async findAll() {
    return this.contactModel.find().sort({ createdAt: -1 }).exec();
  }
}
