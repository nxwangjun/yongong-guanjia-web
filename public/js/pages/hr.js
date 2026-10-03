/* 管人模块：员工档案 / 合同管理 / 考勤工时 / 薪资 / 社保 / 证照资质 */
window.PAGES = window.PAGES || {};

const STATUS_OPT = [['on', '在职'], ['left', '离职']];

PAGES.staff = {
  title: '员工档案',
  render(c) {
    return UI.crudPage(c, {
      title: '员工档案',
      col: 'employees',
      desc: '员工主数据、花名册、在职状态、入离职。录入后风险扫描会自动核算。',
      fields: [
        { k: 'name', t: '姓名', type: 'text', required: true },
        { k: 'empNo', t: '工号', type: 'text' },
        { k: 'dept', t: '部门', type: 'text' },
        { k: 'entryDate', t: '入职日期', type: 'date', required: true },
        { k: 'status', t: '在职状态', type: 'select', options: STATUS_OPT },
        { k: 'leaveProof', t: '已出具离职证明', type: 'check' },
      ],
    });
  },
};

PAGES.contract = {
  title: '合同管理',
  render(c) {
    return UI.crudPage(c, {
      title: '劳动合同',
      col: 'contracts',
      desc: '签订、续签、到期提醒。试用期上限由系统按合同期限自动核算。',
      fields: [
        { k: 'employeeId', t: '员工', type: 'emp', required: true },
        { k: 'type', t: '合同类型', type: 'select', options: [['fixed', '固定期限'], ['open', '无固定期限'], ['task', '以完成一定工作任务为期限']] },
        { k: 'months', t: '合同期限（月）', type: 'number' },
        { k: 'probationMonths', t: '试用期（月）', type: 'number' },
        { k: 'signDate', t: '签订日期', type: 'date' },
        { k: 'endDate', t: '到期日期', type: 'date' },
      ],
    });
  },
};

PAGES.attend = {
  title: '考勤工时',
  render(c) {
    return UI.crudPage(c, {
      title: '考勤与加班',
      col: 'attendances',
      desc: '月加班超过 36 小时将触发风险（劳动法第41条）。',
      fields: [
        { k: 'employeeId', t: '员工', type: 'emp', required: true },
        { k: 'month', t: '月份', type: 'text' },
        { k: 'overtimeHours', t: '加班小时数', type: 'number' },
        { k: 'hours', t: '出勤小时数', type: 'number' },
      ],
    });
  },
};

PAGES.payroll = {
  title: '薪资报酬',
  render(c) {
    return UI.crudPage(c, {
      title: '薪资报酬',
      col: 'payrolls',
      desc: '低于当地最低工资、试用期工资不足转正 80%、有加班无加班费都会触发风险。',
      fields: [
        { k: 'employeeId', t: '员工', type: 'emp', required: true },
        { k: 'month', t: '月份', type: 'text' },
        { k: 'amount', t: '月工资金额', type: 'number' },
        { k: 'overtimePay', t: '加班费', type: 'number' },
        { k: 'probation', t: '是否试用期工资', type: 'check' },
        { k: 'formalAmount', t: '转正工资（试用期填）', type: 'number' },
      ],
    });
  },
};

PAGES.social = {
  title: '社保信息',
  render(c) {
    return UI.crudPage(c, {
      title: '社保信息',
      col: 'socials',
      desc: '在职但无参保记录，或未在用工之日起 30 日内办理登记的，会触发风险。',
      fields: [
        { k: 'employeeId', t: '员工', type: 'emp', required: true },
        { k: 'insured', t: '已参保', type: 'select', options: [['1', '是'], ['0', '否']] },
        { k: 'base', t: '缴纳基数', type: 'number' },
      ],
    });
  },
};

PAGES.cert = {
  title: '证照资质',
  render(c) {
    return UI.crudPage(c, {
      title: '证照资质',
      col: 'certs',
      desc: '特种作业、特种设备作业人员证等有效期管理，到期前 30 天提醒。',
      fields: [
        { k: 'employeeId', t: '员工', type: 'emp', required: true },
        { k: 'name', t: '证照名称', type: 'text', required: true },
        { k: 'no', t: '证书编号', type: 'text' },
        { k: 'expireDate', t: '有效期至', type: 'date' },
      ],
    });
  },
};
