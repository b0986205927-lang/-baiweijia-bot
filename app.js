const express = require('express');
const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

// 老闆娘的 LINE User ID（在 LINE 傳「查ID」取得後，填進 Render 環境變數 OWNER_USER_ID）
const OWNER_USER_ID = process.env.OWNER_USER_ID || '';

// 收款資訊（可依新樂百貨實際帳號修改）
const BANK_INFO = '銀行代號：807（永豐）\n帳號：159—018—00016117';
const TWQR_INFO = 'TWQR 掃碼／行動銀行轉帳：同上方帳號（或掃描店面 TWQR 立牌）';
const LINEPAY_PERSONAL_INFO = 'LINE Pay / iPASS MONEY 個人轉帳：請掃描老闆娘收款碼或轉帳後點擊下方回報末五碼';

const client = new line.Client(config);
const app = express();

// ==========================================
// 【新樂百貨商品清單】平板開 GitHub 可直接修改價格與品項
// ==========================================
const menuDB = [
  { item_id: 'L01', category: '女性無痕內衣', name: '零感無痕內衣（膚色-M）', price: 390, is_sold_out: false },
  { item_id: 'L02', category: '女性無痕內衣', name: '零感無痕內衣（黑色-L）', price: 390, is_sold_out: false },
  { item_id: 'L03', category: '女性親膚內褲', name: '冰絲無痕女三角褲（3件組-均碼）', price: 250, is_sold_out: false },
  { item_id: 'M01', category: '男性舒適內褲', name: '純棉透氣男平口褲（黑色-L）', price: 199, is_sold_out: false },
  { item_id: 'M02', category: '男性舒適內褲', name: '純棉透氣男平口褲（深藍-XL）', price: 199, is_sold_out: false },
];

const cartDB = new Map();
const pendingDepositDB = new Map();
const ordersDB = [];

function addToCart(userId, item, options) {
  const opt = options || '';
  const cart = cartDB.get(userId) || [];
  const existing = cart.find(function (c) {
    return c.item_id === item.item_id && c.options === opt;
  });
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      item_id: item.item_id,
      name: item.name,
      price: item.price,
      qty: 1,
      options: opt,
    });
  }
  cartDB.set(userId, cart);
}

function getCartSummary(userId) {
  const list = cartDB.get(userId) || [];
  let totalAmount = 0;
  const lines = list.map(function (item) {
    const subtotal = item.price * item.qty;
    totalAmount += subtotal;
    const optText = item.options ? '（' + item.options + '）' : '';
    return '• ' + item.name + optText + ' x' + item.qty + ' = $' + subtotal;
  });
  return {
    list: list,
    totalAmount: totalAmount,
    summaryText: lines.length ? lines.join('\n') : '購物車目前是空的',
  };
}

function sendMenuFlex(replyToken) {
  const itemBoxes = menuDB.map(function (m) {
    return {
      type: 'box',
      layout: 'horizontal',
      margin: 'md',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          flex: 3,
          contents: [
            { type: 'text', text: m.name, weight: 'bold', size: 'sm', wrap: true },
            {
              type: 'text',
              text: m.is_sold_out ? '已售完' : '$' + m.price + '・' + m.category,
              size: 'xs',
              color: m.is_sold_out ? '#E63946' : '#666666',
              margin: 'xs',
            },
          ],
        },
        {
          type: 'button',
          style: m.is_sold_out ? 'secondary' : 'primary',
          color: m.is_sold_out ? '#CCCCCC' : '#1DB446',
          height: 'sm',
          flex: 2,
          action: {
            type: 'postback',
            label: m.is_sold_out ? '已售完' : '加入',
            data: 'action=add_item&item_id=' + encodeURIComponent(m.item_id),
          },
        },
      ],
    };
  });

  return client.replyMessage(replyToken, {
    type: 'flex',
    altText: '新樂百貨商品目錄',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '新樂百貨｜精選內衣褲', weight: 'bold', size: 'lg', color: '#1DB446' },
          { type: 'text', text: '滿 $500 享現場取貨付現金！', size: 'xs', color: '#E63946', margin: 'xs' },
          { type: 'separator', margin: 'md' },
        ]
          .concat(itemBoxes)
          .concat([
            {
              type: 'button',
              style: 'primary',
              color: '#2A9D8F',
              margin: 'lg',
              height: 'sm',
              action: {
                type: 'postback',
                label: '前往選擇取貨時間',
                data: 'action=checkout_time',
              },
            },
          ]),
      },
    },
  });
}

function sendCartFlex(replyToken, userId, headerTitle) {
  const title = headerTitle || '目前購物車';
  const summary = getCartSummary(userId);
  const diff500 = 500 - summary.totalAmount;
  const promoHint =
    diff500 > 0
      ? '再湊 $' + diff500 + ' 即可享滿 $500 現場付現金！'
      : '已滿 $500！結帳可選擇現場付現金（免先付訂金）';

  return client.replyMessage(replyToken, {
    type: 'flex',
    altText: title,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: title, weight: 'bold', size: 'lg', color: '#2A9D8F' },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: summary.summaryText, size: 'sm', margin: 'md', wrap: true },
          { type: 'text', text: '總金額：$' + summary.totalAmount, weight: 'bold', size: 'md', margin: 'md' },
          { type: 'text', text: promoHint, size: 'xs', color: '#E63946', margin: 'xs', wrap: true },
          {
            type: 'button',
            style: 'primary',
            color: '#1DB446',
            margin: 'lg',
            height: 'sm',
            action: {
              type: 'postback',
              label: '選擇取貨時間',
              data: 'action=checkout_time',
            },
          },
          {
            type: 'button',
            style: 'secondary',
            margin: 'sm',
            height: 'sm',
            action: {
              type: 'postback',
              label: '清空購物車',
              data: 'action=clear_cart',
            },
          },
        ],
      },
    },
  });
}

function sendPickupTimeFlex(replyToken, userId) {
  const summary = getCartSummary(userId);
  if (!summary.list.length || summary.totalAmount <= 0) {
    return client.replyMessage(replyToken, {
      type: 'text',
      text: '您的購物車目前是空的喔！請輸入「我要選購」挑選商品。',
    });
  }

  const times = ['今天下午取貨', '今天晚上取貨', '明天取貨', '預約店面自取'];
  const buttons = times.map(function (t) {
    return {
      type: 'button',
      style: 'primary',
      color: '#2A9D8F',
      margin: 'sm',
      height: 'sm',
      action: {
        type: 'postback',
        label: t,
        data: 'action=select_pickup&time=' + encodeURIComponent(t),
      },
    };
  });

  return client.replyMessage(replyToken, {
    type: 'flex',
    altText: '選擇取貨時間',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '請選擇預計取貨時間', weight: 'bold', size: 'lg', color: '#2A9D8F' },
          { type: 'text', text: '目前訂單金額：$' + summary.totalAmount, size: 'sm', margin: 'sm' },
        ].concat(buttons),
      },
    },
  });
}

function sendPaymentMethodFlex(replyToken, pickupTime, totalAmount, isOver500) {
  const noteText = isOver500
    ? '訂單滿 $500，可選擇「現場付現金」（免先付訂金）或先轉帳。'
    : '訂單未滿 $500，請先完成轉帳並回報帳號末五碼（滿 $500 可現場付現）。';

  const paymentButtons = [
    {
      type: 'button',
      style: 'primary',
      color: '#2A9D8F',
      margin: 'md',
      height: 'sm',
      action: {
        type: 'postback',
        label: '銀行轉帳 / TWQR',
        data:
          'action=pay_method&time=' +
          encodeURIComponent(pickupTime) +
          '&method=' +
          encodeURIComponent('銀行轉帳 / TWQR'),
      },
    },
    {
      type: 'button',
      style: 'primary',
      color: '#06C755',
      margin: 'sm',
      height: 'sm',
      action: {
        type: 'postback',
        label: 'LINE Pay 個人轉帳',
        data:
          'action=pay_method&time=' +
          encodeURIComponent(pickupTime) +
          '&method=' +
          encodeURIComponent('LINE Pay 個人轉帳'),
      },
    },
  ];

  // 滿 500 元才開放「現場付現金」按鈕（無先付一半訂金）
  if (isOver500) {
    paymentButtons.push({
      type: 'button',
      style: 'primary',
      color: '#FF6B6B',
      margin: 'sm',
      height: 'sm',
      action: {
        type: 'postback',
        label: '現場付現金（滿500專屬）',
        data: 'action=pay_cash&time=' + encodeURIComponent(pickupTime),
      },
    });
  }

  return client.replyMessage(replyToken, {
    type: 'flex',
    altText: '選擇付款方式',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '選擇付款方式', weight: 'bold', size: 'lg', color: '#E63946' },
          { type: 'text', text: '取貨時間：' + pickupTime + '｜總金額：$' + totalAmount, size: 'sm', margin: 'sm', wrap: true },
          { type: 'text', text: noteText, size: 'xs', color: '#666666', margin: 'xs', wrap: true },
        ].concat(paymentButtons),
      },
    },
  });
}

function sendTransferOptionsFlex(replyToken, pickupTime, totalAmount, method) {
  const detailText =
    method === 'LINE Pay 個人轉帳'
      ? LINEPAY_PERSONAL_INFO
      : BANK_INFO + '\n' + TWQR_INFO;

  return client.replyMessage(replyToken, {
    type: 'flex',
    altText: method + ' 付款資訊',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: method, weight: 'bold', size: 'lg', color: '#E63946' },
          {
            type: 'text',
            text: '應付總金額：$' + totalAmount + '\n\n' + detailText,
            size: 'sm',
            margin: 'md',
            wrap: true,
          },
          {
            type: 'button',
            style: 'primary',
            color: '#2A9D8F',
            margin: 'md',
            height: 'sm',
            action: {
              type: 'postback',
              label: '已完成轉帳 $' + totalAmount + '（回報末五碼）',
              data:
                'action=ask_last5&time=' +
                encodeURIComponent(pickupTime) +
                '&label=' +
                encodeURIComponent(method + ' - 已付清 $' + totalAmount),
            },
          },
        ],
      },
    },
  });
}
function handleDepositCheck(event, userId, pickupTime) {
  const summary = getCartSummary(userId);
  if (!summary.list.length || summary.totalAmount <= 0) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '您的購物車目前是空的喔！請輸入「我要選購」挑選商品。',
    });
  }
  return sendPaymentMethodFlex(event.replyToken, pickupTime, summary.totalAmount, summary.totalAmount >= 500);
}

async function finalizeOrder(event, userId, pickupTime, paymentStatus) {
  const summary = getCartSummary(userId);
  if (!summary.list.length || summary.totalAmount <= 0) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '您的購物車目前是空的喔！請輸入「我要選購」挑選商品。',
    });
  }

  let userName = 'LINE 顧客';
  try {
    const profile = await client.getProfile(userId);
    if (profile && profile.displayName) {
      userName = profile.displayName;
    }
  } catch (_) {}

  const now = new Date();
  const orderId =
    'ORD-' +
    now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    '-' +
    String(ordersDB.length + 1).padStart(3, '0');

  ordersDB.push({
    order_id: orderId,
    created_at: now.toISOString(),
    pickup_time: pickupTime,
    user_id: userId,
    user_name: userName,
    items_detail: summary.list,
    total_amount: summary.totalAmount,
    payment_status: paymentStatus,
  });

  cartDB.delete(userId);

  if (OWNER_USER_ID) {
    await client.pushMessage(OWNER_USER_ID, {
      type: 'text',
      text:
        '【新樂百貨新訂單】' +
        orderId +
        '\n顧客：' +
        userName +
        '\n取貨時間：' +
        pickupTime +
        '\n付款方式：' +
        paymentStatus +
        '\n---\n' +
        summary.summaryText +
        '\n---\n總金額：$' +
        summary.totalAmount,
    });
  }

  return client.replyMessage(event.replyToken, {
    type: 'flex',
    altText: '新樂百貨訂單成立通知',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '新樂百貨｜訂單成立！', weight: 'bold', size: 'lg', color: '#1DB446' },
          { type: 'text', text: '單號：' + orderId, size: 'sm', margin: 'md', weight: 'bold' },
          { type: 'text', text: '預計取貨：' + pickupTime, size: 'sm', margin: 'xs' },
          { type: 'text', text: '付款方式：' + paymentStatus, size: 'sm', margin: 'xs', wrap: true },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: summary.summaryText, size: 'sm', margin: 'md', wrap: true },
          { type: 'text', text: '總金額：$' + summary.totalAmount, weight: 'bold', size: 'md', margin: 'md' },
          {
            type: 'text',
            text: '※ 貼身衣物屬個人衛生用品，售出後恕不退換，感謝您的支持。',
            size: 'xs',
            color: '#888888',
            margin: 'md',
            wrap: true,
          },
          {
            type: 'button',
            style: 'secondary',
            margin: 'lg',
            height: 'sm',
            action: {
              type: 'postback',
              label: '取消此筆訂單',
              data: 'action=cancel_order&orderId=' + encodeURIComponent(orderId),
            },
          },
        ],
      },
    },
  });
}

async function handleEvent(event) {
  if (!event || !event.source) {
    return Promise.resolve(null);
  }
  const userId = event.source.userId;

  if (event.type === 'postback') {
    const params = new URLSearchParams(event.postback.data);
    const action = params.get('action');

    if (action === 'open_menu') {
      return sendMenuFlex(event.replyToken);
    }

    if (action === 'add_item') {
      const itemId = params.get('item_id');
      const item = menuDB.find(function (m) {
        return m.item_id === itemId && !m.is_sold_out;
      });
      if (!item) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '不好意思，這款商品暫時售完囉！',
        });
      }
      addToCart(userId, item, '');
      return sendCartFlex(event.replyToken, userId, '已加入 ' + item.name);
    }

    if (action === 'clear_cart') {
      cartDB.delete(userId);
      pendingDepositDB.delete(userId);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '購物車已清空！輸入「我要選購」可重新挑選商品。',
      });
    }

    if (action === 'checkout_time') {
      return sendPickupTimeFlex(event.replyToken, userId);
    }

    if (action === 'select_pickup') {
      const pickupTime = params.get('time') || '今天下午取貨';
      return handleDepositCheck(event, userId, pickupTime);
    }

    if (action === 'pay_cash') {
      const pickupTime = params.get('time') || '今天下午取貨';
      return finalizeOrder(event, userId, pickupTime, '現場付現金（滿500）');
    }

    if (action === 'pay_method') {
      const pickupTime = params.get('time') || '今天下午取貨';
      const method = params.get('method') || '銀行轉帳 / TWQR';
      const summary = getCartSummary(userId);
      if (!summary.list.length || summary.totalAmount <= 0) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '您的購物車目前是空的喔！請輸入「我要選購」挑選商品。',
        });
      }
      return sendTransferOptionsFlex(event.replyToken, pickupTime, summary.totalAmount, method);
    }

    if (action === 'ask_last5') {
      const pickupTime = params.get('time') || '今天下午取貨';
      const payLabel = params.get('label') || '已轉帳';
      pendingDepositDB.set(userId, { pickupTime: pickupTime, payLabel: payLabel });
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '請直接輸入您的「轉帳帳號末五碼」（例如：12345），方便新樂百貨核對【' + payLabel + '】款項。',
      });
    }

    if (action === 'cancel_order') {
      const cancelId = params.get('orderId') || '';
      const idx = ordersDB.findIndex(function (o) {
        return o.order_id === cancelId && o.user_id === userId;
      });
      if (idx !== -1) {
        ordersDB.splice(idx, 1);
        if (OWNER_USER_ID) {
          await client.pushMessage(OWNER_USER_ID, {
            type: 'text',
            text: '【訂單取消通知】單號 ' + cancelId + ' 已被顧客取消。',
          });
        }
      }
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '訂單 ' + cancelId + ' 已為您取消！若需重新選購請輸入「我要選購」。',
      });
    }

    return Promise.resolve(null);
  }

  if (event.type === 'message' && event.message.type === 'text') {
    const userText = event.message.text.trim();

    if (userText === '查ID' || userText === '查id') {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '您的 LINE User ID 為：\n' + userId + '\n\n請將這串代碼貼到 Render 的 OWNER_USER_ID 環境變數中，即可接收新訂單通知並使用改價指令。',
      });
    }

    if (userText.startsWith('改價 ')) {
      if (OWNER_USER_ID && userId !== OWNER_USER_ID) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '抱歉，只有老闆娘帳號才能使用改價指令喔！',
        });
      }
      const parts = userText.split(/\s+/);
      if (parts.length < 3) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '改價格式錯誤！請輸入：\n改價 商品編號 新價格\n例如：改價 L01 350\n（輸入「價目表」可查看所有商品編號）',
        });
      }
      const target = parts[1];
      const newPrice = parseInt(parts[2], 10);
      if (isNaN(newPrice) || newPrice <= 0) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '價格請輸入大於 0 的數字，例如：改價 L01 350',
        });
      }
      const targetItem = menuDB.find(function (m) {
        return m.item_id.toUpperCase() === target.toUpperCase() || m.name.includes(target);
      });
      if (!targetItem) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '找不到商品「' + target + '」，請輸入「價目表」確認編號與名稱。',
        });
      }
      const oldPrice = targetItem.price;
      targetItem.price = newPrice;
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text:
          '價格已即時更新！\n商品：【' +
          targetItem.item_id +
          '】' +
          targetItem.name +
          '\n原價：$' +
          oldPrice +
          ' ➔ 新價格：$' +
          newPrice,
      });
    }

    if (userText.startsWith('下架 ') || userText.startsWith('上架 ')) {
      if (OWNER_USER_ID && userId !== OWNER_USER_ID) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '抱歉，只有老闆娘帳號才能調整上架狀態喔！',
        });
      }
      const isOff = userText.startsWith('下架 ');
      const target = userText.slice(3).trim();
      const targetItem = menuDB.find(function (m) {
        return m.item_id.toUpperCase() === target.toUpperCase() || m.name.includes(target);
      });
      if (!targetItem) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '找不到商品「' + target + '」，請輸入「價目表」確認編號。',
        });
      }
            targetItem.is_sold_out = isOff;
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '已更新狀態：【' + targetItem.item_id + '】' + targetItem.name + ' 目前為「' + (isOff ? '已售完' : '販售中') + '」',
      });
    }

    if (userText === '價目表') {
      const listText = menuDB
        .map(function (m) {
          return '【' + m.item_id + '】' + m.name + '：$' + m.price + (m.is_sold_out ? '（已售完）' : '');
        })
        .join('\n');
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '新樂百貨目前價目表：\n' + listText + '\n\n老闆改價請輸入：改價 編號 新價格（例：改價 L01 350）',
      });
    }

    if (pendingDepositDB.has(userId)) {
      if (!/^\d{5}$/.test(userText)) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '請輸入 5 碼數字的「轉帳帳號末五碼」（例如：12345）。',
        });
      }
      const pending = pendingDepositDB.get(userId);
      pendingDepositDB.delete(userId);
      return finalizeOrder(event, userId, pending.pickupTime, pending.payLabel + ' (末五碼：' + userText + ')');
    }

    if (userText === '我要選購' || userText === '我要點餐' || userText === '商品目錄') {
      return sendMenuFlex(event.replyToken);
    }

    if (userText === '購物車') {
      return sendCartFlex(event.replyToken, userId, '目前購物車');
    }

    if (userText === '去結帳' || userText === '結帳') {
      return sendPickupTimeFlex(event.replyToken, userId);
    }

    if (userText === '查詢訂單') {
      const myOrders = ordersDB.filter(function (o) {
        return o.user_id === userId;
      });
      if (myOrders.length === 0) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '您目前還沒有成立的訂單喔！想挑選商品請輸入「我要選購」。',
        });
      }
      const latest = myOrders[myOrders.length - 1];
      const itemsText = latest.items_detail
        .map(function (item) {
          const opt = item.options ? '（' + item.options + '）' : '';
          return '• ' + item.name + opt + ' x' + item.qty + ' = $' + item.price * item.qty;
        })
        .join('\n');

      return client.replyMessage(event.replyToken, {
        type: 'flex',
        altText: '您的最新訂單',
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '您的最新訂單', weight: 'bold', size: 'lg', color: '#1DB446' },
              { type: 'text', text: '單號：' + latest.order_id, size: 'sm', margin: 'md', weight: 'bold' },
              { type: 'text', text: '預計取貨：' + latest.pickup_time, size: 'sm', margin: 'xs' },
              { type: 'text', text: '付款方式：' + latest.payment_status, size: 'sm', margin: 'xs', wrap: true },
              { type: 'separator', margin: 'md' },
              { type: 'text', text: itemsText, size: 'sm', margin: 'md', wrap: true },
              { type: 'text', text: '總金額：$' + latest.total_amount, weight: 'bold', size: 'md', margin: 'md' },
              {
                type: 'button',
                style: 'secondary',
                margin: 'lg',
                height: 'sm',
                action: {
                  type: 'postback',
                  label: '取消此筆訂單',
                  data: 'action=cancel_order&orderId=' + encodeURIComponent(latest.order_id),
                },
              },
            ],
          },
        },
      });
    }

    return Promise.resolve(null);
  }

  return Promise.resolve(null);
}

app.post('/callback', line.middleware(config), function (req, res) {
  Promise.all(req.body.events.map(handleEvent))
    .then(function (result) {
      res.json(result);
    })
    .catch(function (err) {
      console.error(err);
      res.status(500).end();
    });
});

const port = process.env.PORT || 3000;
app.listen(port, function () {
  console.log('Server is running on port ' + port);
});
