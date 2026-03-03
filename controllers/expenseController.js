const Expense = require('../models/Expense');
const ExpenseCategory = require('../models/ExpenseCategory');
const Branch = require('../models/Branch');

function buildDateFilter(dateFrom, dateTo) {
  const dateQuery = {};
  const hasDateFilter = [dateFrom, dateTo].some(
    (v) => v != null && String(v).trim() !== ''
  );

  if (hasDateFilter) {
    if (dateFrom) {
      dateQuery.$gte = new Date(dateFrom);
    }
    if (dateTo) {
      const end = new Date(dateTo);
      end.setDate(end.getDate() + 1);
      dateQuery.$lt = end;
    }
  }

  const filter = {
    ...(Object.keys(dateQuery).length > 0 && { date: dateQuery })
  };

  return { filter, hasDateFilter };
}

exports.createCategory = async (req, res) => {
  try {
    const { name, code, description } = req.body;

    if (!name || !code) {
      return res.status(400).json({
        success: false,
        message: 'Name and code are required'
      });
    }

    const exists = await ExpenseCategory.findOne({
      $or: [{ name }, { code }]
    });
    if (exists) {
      return res.status(400).json({
        success: false,
        message: 'Category with this name or code already exists'
      });
    }

    const category = await ExpenseCategory.create({
      name,
      code,
      description
    });

    res.status(201).json({
      success: true,
      message: 'Expense category created successfully',
      data: category
    });
  } catch (error) {
    console.error('Error creating expense category:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while creating expense category',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getCategories = async (req, res) => {
  try {
    const categories = await ExpenseCategory.find({})
      .sort({ name: 1 })
      .lean();

    res.status(200).json({
      success: true,
      message: 'Expense categories retrieved successfully',
      data: categories
    });
  } catch (error) {
    console.error('Error getting expense categories:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while getting expense categories',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.createExpense = async (req, res) => {
  try {
    const { categoryId, type, amount, date, branchId, description } = req.body;

    if (!categoryId || typeof amount === 'undefined') {
      return res.status(400).json({
        success: false,
        message: 'Category and amount are required'
      });
    }

    const category = await ExpenseCategory.findById(categoryId);
    if (!category || !category.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or inactive expense category'
      });
    }

    let branch = null;
    if (branchId) {
      branch = await Branch.findById(branchId);
      if (!branch) {
        return res.status(400).json({
          success: false,
          message: 'Branch not found'
        });
      }
    }

    const expense = await Expense.create({
      category: category._id,
      type,
      amount,
      date: date ? new Date(date) : undefined,
      branch: branch ? branch._id : null,
      description,
      createdBy: req.user && req.user.id ? req.user.id : null
    });

    const populated = await Expense.findById(expense._id)
      .populate('category', 'name code')
      .populate('branch', 'name code city')
      .lean();

    res.status(201).json({
      success: true,
      message: 'Expense created successfully',
      data: populated
    });
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while creating expense',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getExpenseReport = async (req, res) => {
  try {
    const { dateFrom, dateTo, branchId, categoryId } = req.query;
    const { filter, hasDateFilter } = buildDateFilter(dateFrom, dateTo);

    if (branchId) {
      filter.branch = branchId;
    }
    if (categoryId) {
      filter.category = categoryId;
    }

    const expenses = await Expense.find(filter)
      .sort({ date: -1 })
      .populate('category', 'name code')
      .populate('branch', 'name code city')
      .lean();

    const totals = {
      totalExpenses: 0,
      count: expenses.length
    };

    const byCategory = {};
    const byBranch = {};

    expenses.forEach((e) => {
      const amt = e.amount || 0;
      totals.totalExpenses += amt;

      const catKey = e.category ? e.category._id.toString() : 'uncategorized';
      if (!byCategory[catKey]) {
        byCategory[catKey] = {
          categoryId: e.category ? e.category._id : null,
          name: e.category ? e.category.name : 'Uncategorized',
          code: e.category ? e.category.code : null,
          total: 0,
          count: 0
        };
      }
      byCategory[catKey].total += amt;
      byCategory[catKey].count += 1;

      const brKey = e.branch ? e.branch._id.toString() : 'unassigned';
      if (!byBranch[brKey]) {
        byBranch[brKey] = {
          branchId: e.branch ? e.branch._id : null,
          name: e.branch ? e.branch.name : 'Unassigned',
          code: e.branch ? e.branch.code : null,
          city: e.branch ? e.branch.city : null,
          total: 0,
          count: 0
        };
      }
      byBranch[brKey].total += amt;
      byBranch[brKey].count += 1;
    });

    res.status(200).json({
      success: true,
      message: 'Expense report retrieved successfully',
      data: {
        dateRange: {
          from: dateFrom && String(dateFrom).trim() ? dateFrom : null,
          to: dateTo && String(dateTo).trim() ? dateTo : null
        },
        dateFilterApplied: hasDateFilter,
        totals,
        byCategory: Object.values(byCategory),
        byBranch: Object.values(byBranch),
        items: expenses
      }
    });
  } catch (error) {
    console.error('Error getting expense report:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while getting expense report',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

