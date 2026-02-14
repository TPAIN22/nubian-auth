import ticketService from "../services/ticket.service.js";
import { sendSuccess, sendError } from "../lib/response.js";
import { getAuth } from "@clerk/express";
import User from "../models/user.model.js";

// Helper to get local User ID (reused)
const getLocalUser = async (req) => {
    const { userId } = getAuth(req);
    if (!userId) return null;
    return await User.findOne({ clerkId: userId });
};

export const createTicket = async (req, res) => {
  try {
    const user = await getLocalUser(req);
    if (!user) return sendError(res, { message: "User not found", statusCode: 404 });

    const ticket = await ticketService.createTicket(user._id, req.body);
    return sendSuccess(res, { data: ticket, message: "Ticket created successfully" }, 201);
  } catch (error) {
    return sendError(res, { message: error.message, statusCode: 400 });
  }
};

export const getTickets = async (req, res) => {
  try {
    const user = await getLocalUser(req);
    if (!user) return sendError(res, { message: "User not found", statusCode: 404 });

    const filter = {};
    if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
    if (req.query.priority) filter.priority = req.query.priority;
    if (req.query.category && req.query.category !== 'all') filter.category = req.query.category;
    if (req.query.riskScore) filter.riskScore = { $gte: parseInt(req.query.riskScore) };

    const result = await ticketService.getAllTickets(filter, req.query); // pagination in query
    return sendSuccess(res, { data: result.tickets, pagination: result.pagination });
  } catch (error) {
    return sendError(res, { message: error.message, statusCode: 500 });
  }
};

export const getTicketDetails = async (req, res) => {
    try {
        const user = await getLocalUser(req);
        if (!user) return sendError(res, { message: "User not found", statusCode: 404 });

        const ticket = await ticketService.getTicketDetails(req.params.id, user._id, user.role);
        return sendSuccess(res, { data: ticket });
    } catch (error) {
        return sendError(res, { message: error.message, statusCode: 404 }); // or 403
    }
}

export const addMessage = async (req, res) => {
    try {
        const user = await getLocalUser(req);
        if (!user) return sendError(res, { message: "User not found", statusCode: 404 });
        
        // Handle file uploads (Multer middleware should have run before this)
        const attachments = req.files ? req.files.map(file => file.path) : [];

        const message = await ticketService.addMessage(req.params.id, user._id, user.role, {
            message: req.body.message,
            attachments
        });

        return sendSuccess(res, { data: message, message: "Message added" });
    } catch (error) {
        return sendError(res, { message: error.message, statusCode: 500 });
    }
}

export const updateStatus = async (req, res) => {
    try {
        const user = await getLocalUser(req);
        if (!user) return sendError(res, { message: "User not found", statusCode: 404 });

        if (user.role !== 'admin' && user.role !== 'support') {
             return sendError(res, { message: "Unauthorized", statusCode: 403 });
        }

        const ticket = await ticketService.updateTicketStatus(req.params.id, req.body.status, req.body.adminNotes, user._id);
        return sendSuccess(res, { data: ticket, message: "Status updated" });
    } catch (error) {
        return sendError(res, { message: error.message, statusCode: 500 });
    }
}

export const getStats = async (req, res) => {
    try {
        const user = await getLocalUser(req);
        if (!user || (user.role !== 'admin' && user.role !== 'support')) {
            return sendError(res, { message: "Unauthorized", statusCode: 403 });
        }

        const stats = await ticketService.getStats();
        return sendSuccess(res, { data: stats });
    } catch (error) {
        return sendError(res, { message: error.message, statusCode: 500 });
    }
}
