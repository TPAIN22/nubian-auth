import ticketService from "../services/ticket.service.js";
import { sendSuccess, sendError } from "../lib/response.js";
import { getAuth, clerkClient } from "@clerk/express";
import User from "../models/user.model.js";
import { resolveMerchantContext, ACTIVE_STORE_HEADER } from "../middleware/merchant.middleware.js";

const getLocalUser = async (req) => {
    const { userId } = getAuth(req);
    if (!userId) return null;
    return await User.findOne({ clerkId: userId });
};

const getRequestActor = async (req) => {
    const { userId } = getAuth(req);
    if (!userId) return { user: null, clerkRole: null, merchant: null, clerkId: null };

    const user = await User.findOne({ clerkId: userId });

    let clerkRole = req.auth?.sessionClaims?.publicMetadata?.role || null;
    if (!clerkRole) {
        try {
            const clerkUser = await clerkClient.users.getUser(userId);
            clerkRole = clerkUser?.publicMetadata?.role || null;
        } catch (_) {
            clerkRole = null;
        }
    }

    // Tickets are only gated by isAuthenticated, so the store has to be resolved
    // here rather than by a merchant middleware. Going through the membership
    // resolver is what lets a staff member see their store's tickets — keying off
    // Merchant.userId would only ever have matched the owner.
    let merchant = null;
    if (clerkRole === 'merchant') {
        const resolved = await resolveMerchantContext(userId, req.get(ACTIVE_STORE_HEADER));
        // A resolution failure (no store, or several with no header to pick one)
        // degrades to "not acting for a store", which is how this read for every
        // non-merchant already.
        merchant = resolved.merchant || null;
    }

    return { user, clerkRole, merchant, clerkId: userId };
};

export const createTicket = async (req, res) => {
  try {
    const user = await getLocalUser(req);
    if (!user) return sendError(res, { message: "User not found", statusCode: 404 });

    const attachments = req.body.attachments || [];
    const ticket = await ticketService.createTicket(user._id, { ...req.body, attachments });
    return sendSuccess(res, { data: ticket, message: "Ticket created successfully" }, 201);
  } catch (error) {
    return sendError(res, { message: error.message, statusCode: 400 });
  }
};

export const getTickets = async (req, res) => {
  try {
    const { user, clerkRole, merchant } = await getRequestActor(req);

    const isStaff = clerkRole === 'admin' || clerkRole === 'support' || user?.role === 'admin' || user?.role === 'support';

    if (!user && !isStaff) return sendError(res, { message: "User not found", statusCode: 404 });

    const filter = {};
    if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
    if (req.query.priority) filter.priority = req.query.priority;
    if (req.query.category && req.query.category !== 'all') filter.category = req.query.category;
    if (req.query.riskScore) filter.riskScore = { $gte: parseInt(req.query.riskScore) };

    if (isStaff) {
        // no restriction
    } else if (clerkRole === 'merchant') {
        if (!merchant) {
            return sendError(res, { message: "Merchant profile not found", statusCode: 403 });
        }
        filter.$or = [
          { relatedMerchantId: merchant._id },
          { userId: user._id }
        ];
    } else {
        filter.userId = user._id;
    }

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const pagination = { skip: (page - 1) * limit, limit };

    const result = await ticketService.getAllTickets(filter, pagination);
    const total = result.total || 0;
    return sendSuccess(res, {
      data: result.tickets,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    return sendError(res, { message: error.message, statusCode: 500 });
  }
};

export const getTicketDetails = async (req, res) => {
    try {
        const { user, clerkRole, merchant } = await getRequestActor(req);
        const isStaff = clerkRole === 'admin' || clerkRole === 'support' || user?.role === 'admin' || user?.role === 'support';
        if (!user && !isStaff) return sendError(res, { message: "User not found", statusCode: 404 });

        const effectiveRole = isStaff ? (clerkRole || user?.role) : user?.role;
        const ticket = await ticketService.getTicketDetails(req.params.id, user?._id, effectiveRole, merchant?._id || null);
        return sendSuccess(res, { data: ticket });
    } catch (error) {
        return sendError(res, { message: error.message, statusCode: 404 });
    }
}

export const addMessage = async (req, res) => {
    try {
        const { user, clerkRole, merchant } = await getRequestActor(req);
        const isStaff = clerkRole === 'admin' || clerkRole === 'support' || user?.role === 'admin' || user?.role === 'support';
        if (!user && !isStaff) return sendError(res, { message: "User not found", statusCode: 404 });

        const attachments = req.body.attachments || [];
        const effectiveRole = isStaff ? (clerkRole || user?.role) : user?.role;

        const message = await ticketService.addMessage(req.params.id, user?._id, effectiveRole, {
            message: req.body.message,
            attachments
        }, merchant?._id || null);

        return sendSuccess(res, { data: message, message: "Message added" });
    } catch (error) {
        const msg = error.message || "";
        let statusCode = 500;
        if (msg.includes("Unauthorized")) statusCode = 403;
        else if (msg.includes("not found")) statusCode = 404;
        return sendError(res, { message: msg, statusCode });
    }
}

export const updateStatus = async (req, res) => {
    try {
        const user = await getLocalUser(req);
        const ticket = await ticketService.updateTicketStatus(req.params.id, req.body.status, req.body.adminNotes, user?._id);
        return sendSuccess(res, { data: ticket, message: "Status updated" });
    } catch (error) {
        return sendError(res, { message: error.message, statusCode: 500 });
    }
}

export const getStats = async (req, res) => {
    try {
        const stats = await ticketService.getStats();
        return sendSuccess(res, { data: stats });
    } catch (error) {
        return sendError(res, { message: error.message, statusCode: 500 });
    }
}
