const PDFDocument = require('pdfkit');
const UserAuth = require('../models/UserAuth');
const Branch = require('../models/Branch');
const EmployeePayroll = require('../models/EmployeePayroll');
const Payroll = require('../models/Payroll');

function validatePeriod(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m || m < 1 || m > 12) {
    return null;
  }
  return { year: y, month: m };
}

exports.getPayrollEmployees = async (req, res) => {
  try {
    const roles = ['admin', 'operation', 'operationPortal', 'rider'];
    const users = await UserAuth.find({ role: { $in: roles } })
      .select('fullName username email role')
      .lean();

    const configs = await EmployeePayroll.find({ isActive: true })
      .populate('branch', 'name code city')
      .lean();

    const configByUser = new Map();
    configs.forEach((c) => {
      configByUser.set(String(c.user), c);
    });

    const data = users.map((u) => {
      const cfg = configByUser.get(String(u._id));
      return {
        userId: u._id,
        fullName: u.fullName,
        username: u.username,
        email: u.email,
        role: u.role,
        branch: cfg && cfg.branch
          ? {
              id: cfg.branch._id,
              name: cfg.branch.name,
              code: cfg.branch.code,
              city: cfg.branch.city
            }
          : null,
        baseSalary: cfg ? cfg.baseSalary : 0,
        defaultBonus: cfg ? cfg.defaultBonus : 0,
        defaultDeductions: cfg ? cfg.defaultDeductions : 0,
        hasConfig: !!cfg
      };
    });

    res.status(200).json({
      success: true,
      message: 'Payroll employees retrieved successfully',
      data
    });
  } catch (error) {
    console.error('Error getting payroll employees:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while getting payroll employees',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.upsertEmployeePayroll = async (req, res) => {
  try {
    const { userId, branchId, baseSalary, defaultBonus, defaultDeductions, isActive } = req.body;

    if (!userId || typeof baseSalary === 'undefined') {
      return res.status(400).json({
        success: false,
        message: 'userId and baseSalary are required'
      });
    }

    const user = await UserAuth.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
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

    const update = {
      branch: branch ? branch._id : null,
      baseSalary,
      defaultBonus: typeof defaultBonus !== 'undefined' ? defaultBonus : 0,
      defaultDeductions: typeof defaultDeductions !== 'undefined' ? defaultDeductions : 0
    };
    if (typeof isActive !== 'undefined') {
      update.isActive = !!isActive;
    }

    const config = await EmployeePayroll.findOneAndUpdate(
      { user: userId },
      { $set: update, user: userId },
      { new: true, upsert: true }
    )
      .populate('branch', 'name code city')
      .lean();

    res.status(200).json({
      success: true,
      message: 'Employee payroll configuration saved successfully',
      data: config
    });
  } catch (error) {
    console.error('Error upserting employee payroll:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while saving employee payroll config',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.generatePayroll = async (req, res) => {
  try {
    const { year, month, autoSave = false } = req.body;
    const period = validatePeriod(year, month);
    if (!period) {
      return res.status(400).json({
        success: false,
        message: 'Invalid year or month'
      });
    }

    const configs = await EmployeePayroll.find({ isActive: true })
      .populate('user', 'fullName email role')
      .populate('branch', 'name code city')
      .lean();

    if (configs.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active employee payroll configurations found'
      });
    }

    const items = [];

    for (const cfg of configs) {
      const baseSalary = cfg.baseSalary || 0;
      const bonus = cfg.defaultBonus || 0;
      const deductions = cfg.defaultDeductions || 0;
      const netPay = Math.max(0, baseSalary + bonus - deductions);

      let payrollDoc = null;

      if (autoSave) {
        payrollDoc = await Payroll.findOneAndUpdate(
          { employee: cfg.user._id, year: period.year, month: period.month },
          {
            $set: {
              branch: cfg.branch ? cfg.branch._id : null,
              baseSalary,
              bonus,
              deductions,
              netPay
            },
            $setOnInsert: {
              status: 'unpaid',
              generatedAt: new Date()
            }
          },
          { upsert: true, new: true }
        )
          .populate('employee', 'fullName email role')
          .populate('branch', 'name code city')
          .lean();
      }

      items.push({
        id: payrollDoc ? payrollDoc._id : null,
        employeeId: cfg.user._id,
        fullName: cfg.user.fullName,
        email: cfg.user.email,
        role: cfg.user.role,
        branch: cfg.branch
          ? {
              id: cfg.branch._id,
              name: cfg.branch.name,
              code: cfg.branch.code,
              city: cfg.branch.city
            }
          : null,
        baseSalary,
        bonus,
        deductions,
        netPay,
        status: payrollDoc ? payrollDoc.status : 'unpaid',
        generatedAt: payrollDoc ? payrollDoc.generatedAt : null
      });
    }

    res.status(200).json({
      success: true,
      message: autoSave
        ? 'Payroll generated and saved successfully'
        : 'Payroll preview generated successfully',
      data: {
        period,
        items
      }
    });
  } catch (error) {
    console.error('Error generating payroll:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while generating payroll',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getPayrollHistory = async (req, res) => {
  try {
    const { year, month, employeeId, branchId } = req.query;

    const query = {};
    if (year) query.year = Number(year);
    if (month) query.month = Number(month);
    if (employeeId) query.employee = employeeId;
    if (branchId) query.branch = branchId;

    const items = await Payroll.find(query)
      .sort({ year: -1, month: -1, createdAt: -1 })
      .populate('employee', 'fullName email role')
      .populate('branch', 'name code city')
      .lean();

    const mapped = items.map((p) => ({
      id: p._id,
      employeeId: p.employee ? p.employee._id : null,
      fullName: p.employee ? p.employee.fullName : 'N/A',
      email: p.employee ? p.employee.email : null,
      role: p.employee ? p.employee.role : null,
      branch: p.branch
        ? {
            id: p.branch._id,
            name: p.branch.name,
            code: p.branch.code,
            city: p.branch.city
          }
        : null,
      year: p.year,
      month: p.month,
      baseSalary: p.baseSalary,
      bonus: p.bonus,
      deductions: p.deductions,
      netPay: p.netPay,
      status: p.status,
      generatedAt: p.generatedAt
    }));

    res.status(200).json({
      success: true,
      message: 'Payroll history retrieved successfully',
      data: mapped
    });
  } catch (error) {
    console.error('Error getting payroll history:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while getting payroll history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.updatePayrollItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { baseSalary, bonus, deductions, status } = req.body;

    const payroll = await Payroll.findById(id);
    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll item not found'
      });
    }

    if (typeof baseSalary !== 'undefined') payroll.baseSalary = baseSalary;
    if (typeof bonus !== 'undefined') payroll.bonus = bonus;
    if (typeof deductions !== 'undefined') payroll.deductions = deductions;
    if (status && ['paid', 'unpaid'].includes(status)) payroll.status = status;

    payroll.netPay = Math.max(
      0,
      (payroll.baseSalary || 0) + (payroll.bonus || 0) - (payroll.deductions || 0)
    );

    await payroll.save();

    const populated = await Payroll.findById(payroll._id)
      .populate('employee', 'fullName email role')
      .populate('branch', 'name code city')
      .lean();

    res.status(200).json({
      success: true,
      message: 'Payroll item updated successfully',
      data: populated
    });
  } catch (error) {
    console.error('Error updating payroll item:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while updating payroll item',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getPayrollSlip = async (req, res) => {
  try {
    const { id } = req.params;

    const payroll = await Payroll.findById(id)
      .populate('employee', 'fullName email role')
      .populate('branch', 'name code city')
      .lean();

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll item not found'
      });
    }

    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=salary-slip-${payroll._id}.pdf`
    );
    doc.pipe(res);

    doc.fontSize(18).text('My COURIER SERVICE', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).text('Salary Slip', { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(10);
    doc.text(`Employee: ${payroll.employee ? payroll.employee.fullName : 'N/A'}`);
    doc.text(`Email: ${payroll.employee ? payroll.employee.email : 'N/A'}`);
    doc.text(`Role: ${payroll.employee ? payroll.employee.role : 'N/A'}`);
    if (payroll.branch) {
      doc.text(
        `Branch: ${payroll.branch.name} (${payroll.branch.code}) - ${payroll.branch.city}`
      );
    }
    doc.text(`Period: ${payroll.year}-${String(payroll.month).padStart(2, '0')}`);
    doc.text(`Status: ${payroll.status}`);
    doc.moveDown(1);

    doc.text(`Base Salary: Rs ${payroll.baseSalary}`);
    doc.text(`Bonus: Rs ${payroll.bonus}`);
    doc.text(`Deductions: Rs ${payroll.deductions}`);
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Net Pay: Rs ${payroll.netPay}`, { underline: true });

    doc.moveDown(2);
    doc.fontSize(8).text('This is a system generated salary slip.', {
      align: 'center'
    });

    doc.end();
  } catch (error) {
    console.error('Error generating payroll slip:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while generating salary slip',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

