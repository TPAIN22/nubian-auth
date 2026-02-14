import ticketService from "../services/ticket.service.js";
import { sendSuccess, sendError, sendCreated } from "../lib/response.js";
import { getAuth } from "@clerk/express";
import User from "../models/user.model.js"; // Direct access for auth mapping
import logger from "../lib/logger.js";

// Helper to get local User ID from Clerk ID
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
    
    return sendCreated(res, ticket, "Ticket created successfully");
  } catch (error) {
    logger.error("Create Ticket Error", { error: error.message });
    return sendError(res, { 
        message: error.message, 
        statusCode: error.message.includes("Limit") ? 429 : 500 
    });
  }
};

export const getTickets = async (req, res) => {
  try {
    const user = await getLocalUser(req);
    if (!user) return sendError(res, { message: "User not found", statusCode: 404 });

    // Filter logic
    const filter = {};
    const isAdmin = user.role === 'admin' || user.role === 'support'; // Assuming 'role' field exists on User model
    
    if (!isAdmin) {
        filter.userId = user._id;
    } else {
        // Admin filters
        if (req.query.status) filter.status = req.query.status;
        if (req.query.priority) filter.priority = req.query.priority;
        if (req.query.userId) filter.userId = req.query.userId;
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const result = await ticketService.getAllTickets(filter, { skip, limit });
    
    return sendSuccess(res, {
        data: result.tickets,
        meta: {
            total: result.total,
            page,
            limit
        }
    });
  } catch (error) {
    logger.error("Get Tickets Error", { error: error.message });
    return sendError(res, { message: "Failed to retrieve tickets", statusCode: 500 });
  }
};

export const getTicketById = async (req, res) => {
  try {
    const user = await getLocalUser(req);
    if (!user) return sendError(res, { message: "User not found", statusCode: 404 });

    const ticket = await ticketService.getTicketDetails(
        req.params.id, 
        user._id, 
        user.role || 'user'
    );

    return sendSuccess(res, { data: ticket });
  } catch (error) {
      if (error.message === "Ticket not found") return sendError(res, { message: error.message, statusCode: 404 });
      if (error.message.includes("Unauthorized")) return sendError(res, { message: error.message, statusCode: 403 });
      
      logger.error("Get Ticket Detail Error", { error: error.message });
      return sendError(res, { message: "Failed to get ticket details", statusCode: 500 });
  }
};

export const updateTicketStatus = async (req, res) => {
  try {
    const user = await getLocalUser(req);
    if (!user) return sendError(res, { message: "User not found", statusCode: 404 });

    if (user.role !== 'admin' && user.role !== 'support') {
        return sendError(res, { message: "Unauthorized", statusCode: 403 });
    }

    const { status, adminNotes } = req.body;
    const ticket = await ticketService.updateTicketStatus(req.params.id, status, adminNotes, user._id);

    return sendSuccess(res, { data: ticket, message: "Status updated" });
  } catch (error) {
    logger.error("Update Ticket Status Error", { error: error.message });
    return sendError(res, { message: "Failed to update status", statusCode: 500 });
  }
};

export const addMessage = async (req, res) => {
  try {
    const user = await getLocalUser(req);
    if (!user) return sendError(res, { message: "User not found", statusCode: 404 });

    const message = await ticketService.addMessage(
        req.params.id,
        user._id,
        user.role || 'user',
        req.body
    );

    return sendSuccess(res, { data: message, message: "Message added" });
  } catch (error) {
      logger.error("Add Message Error", { error: error.message });
      return sendError(res, { message: error.message, statusCode: 500 });
  }
};
