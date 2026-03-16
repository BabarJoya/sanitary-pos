import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db, addToSyncQueue } from '../services/db'
import { recordAuditLog } from '../services/auditService'

function POS() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()

  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [customers, setCustomers] = useState([])
  const [brands, setBrands] = useState([])

  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedBrand, setSelectedBrand] = useState('')

  const [cart, setCart] = useState([])
  const [customerId, setCustomerId] = useState('')
  const [walkInName, setWalkInName] = useState('')
  const [paymentType, setPaymentType] = useState('cash')
  const [receivedAmount, setReceivedAmount] = useState('') // New state for partial payments
  const [payments, setPayments] = useState([]) // [{method, amount}]
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [discount, setDiscount] = useState(0)
  const [saleType, setSaleType] = useState('sale')
  const [saving, setSaving] = useState(false)
  const [lastReceipt, setLastReceipt] = useState(null)
  const [showQuotationSearch, setShowQuotationSearch] = useState(false)
  const [quotationIdInput, setQuotationIdInput] = useState('')
  const [form, setForm] = useState(() => {
    const saved = localStorage.getItem('shop_settings_full')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) { /* fallback */ }
    }
    return {
      name: localStorage.getItem('shop_name') || 'Sanitary POS',
      phone: '',
      address: '',
      invoice_footer: 'شکریہ! دوبارہ تشریف لائیں',
      quotation_footer: 'یہ صرف قیمت نامہ ہے',
      print_size: 'thermal',
      print_mode: 'manual',
      logo_url: localStorage.getItem('shop_logo') || '',
      wa_reminder_template: 'Hello [Name], this is a reminder from [Shop Name] regarding your outstanding balance of Rs. [Amount]. Please clear your dues at your earliest convenience. Thank you!',
      wa_bill_template: 'Hello [Name], thank you for shopping at [Shop Name]! Your bill summary for Invoice #[ID] is Rs. [Amount]. Thank you for your business!'
    }
  })

  // Brand bulk discount modal
  const [showBrandDiscount, setShowBrandDiscount] = useState(false)
  const [brandDiscountType, setBrandDiscountType] = useState('percent')
  const [brandDiscountValue, setBrandDiscountValue] = useState('')

  // Held Carts
  const [heldCarts, setHeldCarts] = useState([])
  const [showHeldCarts, setShowHeldCarts] = useState(false)
  const [showQuickView, setShowQuickView] = useState(false)
  const [showMobileCart, setShowMobileCart] = useState(false)

  useEffect(() => {
    if (user?.shop_id) fetchAll()
  }, [user?.shop_id])

  // Auto-load quotation if ID is in URL
  useEffect(() => {
    const qId = searchParams.get('convertQuote')
    if (qId && products.length > 0) {
      handleAutoConvert(qId)
    }
  }, [searchParams, products])

  useEffect(() => {
    fetchHeldCarts()
    
    // Listen for cross-tab settings updates
    const handleSync = () => {
      console.log('POS: Syncing settings from storage/focus change...')
      fetchAll()
    }
    
    window.addEventListener('storage', handleSync)
    window.addEventListener('focus', handleSync)
    
    return () => {
      window.removeEventListener('storage', handleSync)
      window.removeEventListener('focus', handleSync)
    }
  }, [])

  const fetchHeldCarts = async () => {
    const carts = await db.held_carts.where('shop_id').equals(user.shop_id).toArray()
    setHeldCarts(carts)
  }

  const handleAutoConvert = async (id) => {
    const { data: sale, error } = await supabase
      .from('sales')
      .select('*, sale_items(*)')
      .eq('id', id)
      .single()

    if (sale) {
      const items = sale.sale_items.map(si => {
        const prod = products.find(p => p.id === si.product_id)
        return {
          ...prod,
          id: si.product_id,
          name: si.product_name,
          qty: si.quantity,
          custom_price: si.unit_price,
          cost_price: si.cost_price
        }
      })
      setCart(items)
      setCustomerId(sale.customer_id || '')
      setWalkInName(sale.customer_name || '')
      setSaleType('sale')
    }
  }

  const fetchAll = async () => {
    try {
      if (!user?.shop_id) {
        console.error('POS: Missing user.shop_id!')
        return
      }
      if (!navigator.onLine) throw new Error('Offline');
      const fetchPromise = Promise.all([
        supabase.from('products').select('*, categories(name)').eq('shop_id', user.shop_id).eq('status', 'active'),
        supabase.from('categories').select('*').eq('shop_id', user.shop_id),
        supabase.from('customers').select('*').eq('shop_id', user.shop_id).order('name'),
        supabase.from('brands').select('*').eq('shop_id', user.shop_id).order('name'),
        supabase.from('shops').select('*').eq('id', user.shop_id).maybeSingle()
      ])

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))

      const [p, c, cu, b, s] = await Promise.race([fetchPromise, timeoutPromise])

      // Explicitly check for errors because supabase calls might resolve with {error} instead of throwing
      if (p.error || c.error || cu.error || b.error || s.error) {
        throw new Error('Supabase fetch failed');
      }

      if (p.data) {
        const cleanP = JSON.parse(JSON.stringify(p.data))
        await db.products.bulkPut(cleanP)
      }
      if (c.data) {
        const cleanC = JSON.parse(JSON.stringify(c.data))
        await db.categories.bulkPut(cleanC)
      }
      if (cu.data) {
        const cleanCu = JSON.parse(JSON.stringify(cu.data))
        await db.customers.bulkPut(cleanCu)
      }
      if (b.data) {
        const cleanB = JSON.parse(JSON.stringify(b.data))
        await db.brands.bulkPut(cleanB)
      }
      if (s.data) {
        setForm(prev => {
          const updated = {
            ...prev,
            name: s.data.name || prev.name,
            phone: s.data.phone || prev.phone,
            address: s.data.address || prev.address,
            invoice_footer: s.data.invoice_footer || prev.invoice_footer,
            quotation_footer: s.data.quotation_footer || prev.quotation_footer,
            print_size: s.data.print_size || prev.print_size,
            print_mode: s.data.print_mode || prev.print_mode,
            logo_url: s.data.logo_url || prev.logo_url || localStorage.getItem('shop_logo') || '',
            wa_reminder_template: s.data.wa_reminder_template || prev.wa_reminder_template,
            wa_bill_template: s.data.wa_bill_template || prev.wa_bill_template
          }
          localStorage.setItem('shop_settings_full', JSON.stringify(updated))
          return updated
        })
      }

      // Always render from local DB to merge cloud data with any pending local offline records
      const [lProds, lCats, lCustomers, lBrands] = await Promise.all([
        db.products.toArray(),
        db.categories.toArray(),
        db.customers.toArray(),
        db.brands.toArray()
      ])

      const sid = String(user.shop_id);
      const myProds = lProds.filter(x => String(x.shop_id) === sid)
      const myCats = lCats.filter(x => String(x.shop_id) === sid)
      const myCustomers = lCustomers.filter(x => String(x.shop_id) === sid)
      const myBrands = lBrands.filter(x => String(x.shop_id) === sid)

      setProducts(myProds)
      setCategories(myCats)
      setCustomers(myCustomers)
      setBrands(myBrands)
    } catch (e) {
      console.log('POS: Fetching from local DB (Offline Fallback)')
      try {
        const [lProds, lCats, lCustomers, lBrands] = await Promise.all([
          db.products.toArray(),
          db.categories.toArray(),
          db.customers.toArray(),
          db.brands.toArray()
        ])

        // Filter locally for shop_id just in case, ensuring type safety
        const sid = String(user.shop_id);
        const myProds = lProds.filter(x => String(x.shop_id) === sid)
        const myCats = lCats.filter(x => String(x.shop_id) === sid)
        const myCustomers = lCustomers.filter(x => String(x.shop_id) === sid)
        const myBrands = lBrands.filter(x => String(x.shop_id) === sid)

        setProducts(myProds)
        setCategories(myCats)
        setCustomers(myCustomers)
        setBrands(myBrands)

        // Load shop settings from local DB too
        const sidNumber = Number(user.shop_id)
        const localShop = await db.shops.get(sidNumber)
        if (localShop) {
          setForm(prev => {
            const updated = {
              ...prev,
              name: localShop.name || prev.name,
              phone: localShop.phone || prev.phone,
              address: localShop.address || prev.address,
              logo_url: localShop.logo_url || prev.logo_url || localStorage.getItem('shop_logo') || '',
              invoice_footer: localShop.invoice_footer || prev.invoice_footer,
              quotation_footer: localShop.quotation_footer || prev.quotation_footer,
              print_size: localShop.print_size || prev.print_size,
              print_mode: localShop.print_mode || prev.print_mode,
              wa_reminder_template: localShop.wa_reminder_template || prev.wa_reminder_template,
              wa_bill_template: localShop.wa_bill_template || prev.wa_bill_template
            }
            localStorage.setItem('shop_settings_full', JSON.stringify(updated))
            return updated
          })
        }
      } catch (err) { console.error('Local DB POS Error', err) }
    }
  }

  const filtered = products.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.brand || '').toLowerCase().includes(search.toLowerCase())
    const matchCat = selectedCategory ? String(p.category_id) === String(selectedCategory) : true
    const matchBrand = selectedBrand ? String(p.brand) === String(selectedBrand) : true
    return matchSearch && matchCat && matchBrand
  })

  const addToCart = (product) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === product.id)
      if (existing) {
        if (existing.qty >= product.stock_quantity) { alert('Not enough stock!'); return prev }
        return prev.map(i => i.id === product.id ? { ...i, qty: i.qty + 1 } : i)
      }
      return [{ ...product, qty: 1, custom_price: product.sale_price }, ...prev]
    })
  }

  const updateQty = (id, qty) => {
    const num = parseInt(qty)
    if (isNaN(num) || num < 1) return
    const product = products.find(p => p.id === id)
    if (num > product.stock_quantity) { alert('Not enough stock!'); return }
    setCart(prev => prev.map(i => i.id === id ? { ...i, qty: num } : i))
  }

  const updatePrice = (id, price) => {
    const num = parseFloat(price)
    if (isNaN(num) || num < 0) return
    setCart(prev => prev.map(i => i.id === id ? { ...i, custom_price: num } : i))
  }

  const removeFromCart = (id) => setCart(prev => prev.filter(i => i.id !== id))

  const clearCart = () => {
    setCart([]); setCustomerId(''); setWalkInName(''); setPaymentType('cash'); setReceivedAmount(''); setPayments([]); setDiscount(0)
  }

  const handleHoldBill = async () => {
    if (cart.length === 0) return

    const heldData = {
      shop_id: user.shop_id,
      customer_id: customerId || null,
      customer_name: customerId ? null : walkInName,
      items: cart,
      total,
      saved_at: new Date().toISOString()
    }

    try {
      await db.held_carts.add(heldData)
      await fetchHeldCarts()
      clearCart()
      alert('Bill held successfully! ⏸️')
    } catch (err) {
      alert('Error holding bill: ' + err.message)
    }
  }

  const handleResumeCart = (held) => {
    if (cart.length > 0) {
      if (!confirm('Current cart replace ho jayegi. Continue?')) return
    }
    setCart(held.items)
    setCustomerId(held.customer_id || '')
    setWalkInName(held.customer_name || '')
    db.held_carts.delete(held.id).then(fetchHeldCarts)
    setShowHeldCarts(false)
  }

  const applyBrandDiscount = () => {
    if (!selectedBrand) { alert('Pehle brand select karo!'); return }
    const brandProducts = products.filter(p => p.brand === selectedBrand)
    const val = parseFloat(brandDiscountValue) || 0
    setCart(prev => {
      let updated = [...prev]
      brandProducts.forEach(product => {
        let discountedPrice = product.sale_price
        if (brandDiscountType === 'percent') {
          discountedPrice = product.sale_price - (product.sale_price * val / 100)
        } else {
          discountedPrice = product.sale_price - val
        }
        discountedPrice = Math.max(0, parseFloat(discountedPrice.toFixed(2)))
        const existing = updated.find(i => i.id === product.id)
        if (existing) {
          updated = updated.map(i => i.id === product.id ? { ...i, custom_price: discountedPrice } : i)
        } else {
          updated = [...updated, { ...product, qty: 1, custom_price: discountedPrice }]
        }
      })
      return updated
    })
    setShowBrandDiscount(false)
    setBrandDiscountValue('')
  }

  const subtotal = cart.reduce((sum, i) => sum + i.custom_price * i.qty, 0)
  const totalDiscount = parseFloat(discount) || 0
  const total = Math.max(0, subtotal - totalDiscount)
  const totalProfit = cart.reduce((sum, i) => sum + (i.custom_price - (i.cost_price || 0)) * i.qty, 0) - totalDiscount

  const handleCompleteSale = async () => {
    if (cart.length === 0) { alert('Cart khali hai!'); return }

    // If split payment not used, default to single payment
    const finalPayments = payments.length > 0 ? payments : [{ method: paymentType, amount: (receivedAmount === '' ? total : Number(receivedAmount)) }]
    const totalPaid = finalPayments.reduce((s, p) => s + Number(p.amount), 0)

    if ((paymentType === 'credit' || (paymentType === 'partial' && totalPaid < total)) && !customerId) {
      alert('Balance amount (Udhaar) ke liye customer select karna zaroori hai!');
      return
    }

    setSaving(true)

    // Generate Sale Object
    const saleData = {
      shop_id: user.shop_id,
      customer_id: customerId || null,
      customer_name: customerId ? null : walkInName,
      total_amount: subtotal,
      discount: totalDiscount,
      paid_amount: saleType === 'quotation' ? 0 : totalPaid,
      payment_type: saleType === 'quotation' ? 'quotation' : (finalPayments.length > 1 ? 'split' : finalPayments[0].method),
      sale_type: saleType,
      status: 'completed',
      created_by: user.username,
      created_at: new Date().toISOString()
    }

    // Only include payment_details if it's a split payment (to avoid schema cache errors for standard sales)
    if (saleType !== 'quotation' && finalPayments.length > 1) {
      saleData.payment_details = finalPayments
    }

    let finalSale = null;

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')

      const { data: sale, error: saleError } = await supabase.from('sales').insert([saleData]).select().single()
      if (saleError) throw saleError
      finalSale = sale;

      const items = cart.map(i => ({
        sale_id: sale.id,
        product_id: i.id,
        product_name: i.name,
        quantity: i.qty,
        unit_price: i.custom_price,
        cost_price: i.cost_price || 0,
        line_total: i.custom_price * i.qty,
        returned_qty: 0,
      }))
      const { error: itemsError } = await supabase.from('sale_items').insert(items)
      if (itemsError) throw itemsError

      if (saleType === 'sale') {
        for (const item of cart) {
          const newStock = item.stock_quantity - item.qty
          await supabase.from('products').update({ stock_quantity: newStock }).eq('id', item.id)
          // Mirror to local DB so Inventory page shows accurate stock immediately
          await db.products.update(item.id, { stock_quantity: newStock })
        }
        if (customerId) {
          const balanceIncrease = total - totalPaid
          if (balanceIncrease !== 0) {
            const customer = customers.find(c => String(c.id) === String(customerId))
            const newBalance = (customer?.outstanding_balance || 0) + balanceIncrease
            await supabase.from('customers').update({ outstanding_balance: newBalance }).eq('id', customerId)
            await db.customers.update(customerId, { outstanding_balance: newBalance })
          }
        }
      }
    } catch (error) {
      const errMsg = error?.message || String(error)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        console.log('POS: Intercepted offline failure, routing to local queue...')
        // OFFLINE MODE
        const offlineId = crypto.randomUUID();
        const offlineSaleData = { ...saleData, id: offlineId };
        finalSale = offlineSaleData;

        await addToSyncQueue('sales', 'INSERT', offlineSaleData)

        const items = cart.map(i => ({
          sale_id: offlineId,
          product_id: i.id,
          product_name: i.name,
          quantity: i.qty,
          unit_price: i.custom_price,
          cost_price: i.cost_price || 0,
          line_total: i.custom_price * i.qty,
          returned_qty: 0,
        }))
        await addToSyncQueue('sale_items', 'INSERT', items)

        if (saleType === 'sale') {
          // Update Local Stock
          for (const item of cart) {
            const newStock = item.stock_quantity - item.qty
            await db.products.update(item.id, { stock_quantity: newStock })
            await addToSyncQueue('products', 'UPDATE', { id: item.id, stock_quantity: newStock })
          }
          // Update Local Customer Balance
          if (customerId) {
            const balanceIncrease = total - totalPaid
            if (balanceIncrease !== 0) {
              const customer = customers.find(c => String(c.id) === String(customerId))
              const newBalance = (customer?.outstanding_balance || 0) + balanceIncrease
              await db.customers.update(customerId, { outstanding_balance: newBalance })
              await addToSyncQueue('customers', 'UPDATE', { id: customerId, outstanding_balance: newBalance })
            }
          }
        }
        alert('Offline mode: Sale saved locally. Will sync automatically when online. 🔄')
      } else {
        alert('Error completing sale: ' + error.message)
        setSaving(false)
        return
      }
    }

    const customer = customers.find(c => String(c.id) === String(customerId))
    setLastReceipt({
      sale: finalSale,
      items: cart,
      customer,
      walkInName: customerId ? null : walkInName,
      subtotal,
      totalDiscount,
      total,
      paymentType,
      totalProfit,
      isQuotation: saleType === 'quotation'
    })

    // Auto print for quotation
    if (saleType === 'quotation') {
      const win = window.open('', '_blank')
      const receiptHTML = buildReceiptHTML({
        sale: finalSale, items: cart, customer, subtotal, totalDiscount, total, paymentType
      }, true)
      win.document.write(receiptHTML)
      win.document.close()
    }

    // Audit Log
    recordAuditLog(
      saleType === 'quotation' ? 'CREATE_QUOTATION' : 'PROCESS_SALE',
      'sales',
      finalSale.id,
      {
        total,
        items_count: cart.length,
        payment_type: paymentType,
        customer: customerId ? customers.find(c => c.id === customerId)?.name : walkInName
      },
      user.id,
      user.shop_id
    )

    clearCart()
    fetchAll()
    setSaving(false)
  }

  const handleSearchQuotation = async () => {
    if (!quotationIdInput) return
    let qId = quotationIdInput.trim()

    const loadSaleToCart = (sale) => {
      const items = sale.sale_items.map(si => {
        const prod = products.find(p => p.id === si.product_id)
        return {
          ...prod,
          id: si.product_id,
          name: si.product_name,
          qty: si.quantity,
          custom_price: si.unit_price,
          cost_price: si.cost_price
        }
      })

      setCart(items)
      setCustomerId(sale.customer_id || '')
      setWalkInName(sale.customer_name || '')
      setSaleType('sale') // Switch to sale mode
      setShowQuotationSearch(false)
      setQuotationIdInput('')
    }

    // Support searching with 'QT-' prefix or just the last 8 chars
    if (qId.startsWith('QT-')) qId = qId.replace('QT-', '')

    const query = supabase
      .from('sales')
      .select('*, sale_items(*)')
      .eq('shop_id', user.shop_id)
      .eq('sale_type', 'quotation')

    // If it's a number, try exact match first for performance
    if (!isNaN(qId)) {
      const { data, error } = await query.eq('id', parseInt(qId)).single()
      if (data) {
        loadSaleToCart(data)
        return
      }
    }

    // Fallback: search by partial match. Since ID is integer, we need to cast (if DB allows) 
    // or just search with exact if qId is long enough. 
    // Most users will enter the full number if it's an integer.
    const { data: sale, error } = await query
      .filter('id', 'raw', `"id"::text ilike '%${qId}'`)
      .single()

    if (error || !sale) {
      alert('Quotation nahi mili! Sahi number check karein.')
      return
    }

    loadSaleToCart(sale)
  }

  const buildReceiptHTML = (r, isQuotation = false) => {
    const isThermal = form.print_size === 'thermal'
    const footer = isQuotation ? form.quotation_footer : form.invoice_footer

    return `
    <html><head><title>${isQuotation ? 'Quotation' : 'Receipt'}</title>
    <style>
      body { font-family: monospace; width: ${isThermal ? '320px' : '794px'}; margin: auto; padding: 20px; font-size: 13px; border: ${isThermal ? 'none' : '1px solid #eee'}; }
      h2, p.center { text-align: center; margin: 2px 0; }
      hr { border-top: 1px dashed #000; margin: 6px 0; }
      table { width: 100%; border-collapse: collapse; } 
      td { padding: 5px 0; vertical-align: top; }
      .right { text-align: right; } .bold { font-weight: bold; }
      .logo { display: block; margin: 0 auto 10px; max-width: 100px; }
      ${!isThermal ? `
        body { font-family: 'Segoe UI', sans-serif; }
        table { border: 1px solid #ddd; }
        th, td { border: 1px solid #ddd; padding: 10px; }
        .header-box { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
      ` : ''}
    </style></head><body>
    ${form.logo_url ? `<img src="${form.logo_url}" class="logo" />` : ''}
    <h2>${form.name || 'Sanitary POS'}</h2>
    <p class="center">${form.address || ''}</p>
    <p class="center">Phone: ${form.phone || ''}</p>
    <hr/>
    <p>${isQuotation ? 'QUOTATION' : 'Receipt'} #: ${isQuotation ? 'QT-' : ''}${String(r.sale.id).slice(-8)}</p>
    <p>Date: ${new Date(r.sale.created_at).toLocaleString('en-PK')}</p>
    <p>Cashier: ${r.sale.created_by}</p>
    ${r.customer ? `<p>Customer: ${r.customer.name} | ${r.customer.phone || ''}</p>` : r.walkInName ? `<p>Customer: ${r.walkInName} (Walk-in)</p>` : '<p>Walk-in Customer</p>'}
    ${!isQuotation ? (
        r.sale.payment_type === 'split' && r.sale.payment_details
          ? `<p>Payment: SPLIT</p>
         ${r.sale.payment_details.map(p => `<p style="margin:0; padding-left:10px;">- ${p.method.toUpperCase()}: Rs. ${Number(p.amount).toFixed(0)}</p>`).join('')}`
          : `<p>Payment: ${r.paymentType.toUpperCase()}</p>`
      ) : ''}
    <hr/>
    <table>
      <thead>
        <tr><th align="left">Item</th><th align="right">Qty</th><th align="right">Rate</th><th align="right">Amt</th></tr>
      </thead>
      <tbody>
        ${r.items.map(i => `<tr>
          <td>${i.name}${i.brand ? ' (' + i.brand + ')' : ''}</td>
          <td class="right">${i.qty}</td>
          <td class="right">${Number(i.custom_price || i.unit_price).toFixed(0)}</td>
          <td class="right">${((i.custom_price || i.unit_price) * i.qty).toFixed(0)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <hr/>
    <div style="width: 200px; margin-left: auto;">
      <table style="border: none;">
        <tr style="border: none;"><td style="border: none;">Subtotal</td><td class="right" style="border: none;">Rs. ${r.subtotal.toFixed(0)}</td></tr>
        ${r.totalDiscount > 0 ? `<tr style="border: none;"><td style="border: none;">Discount</td><td class="right" style="border: none;">- Rs. ${r.totalDiscount.toFixed(0)}</td></tr>` : ''}
        <tr style="border: none;"><td class="bold" style="border: none;">TOTAL</td><td class="right bold" style="border: none;">Rs. ${r.total.toFixed(0)}</td></tr>
        ${!isQuotation && (r.total - r.sale.paid_amount) > 0 ? `
          <tr style="border: none; color: red;"><td style="border: none;">Remaining </td><td class="right" style="border: none;">Rs. ${(r.total - r.sale.paid_amount).toFixed(0)}</td></tr>
        ` : ''}
      </table>
    </div>
    <hr/>
    <p class="center" style="font-size: 16px; font-weight: bold; margin-top: 10px;">${footer}</p>
    <script>
      window.onload = function() {
        const images = document.getElementsByTagName('img');
        if (images.length > 0) {
          let loadedCount = 0;
          for (let img of images) {
            if (img.complete) {
              loadedCount++;
            } else {
              img.onload = function() {
                loadedCount++;
                if (loadedCount === images.length) {
                  setTimeout(() => { window.print(); window.close(); }, 300);
                }
              };
              img.onerror = function() { // Print even if logo fails
                loadedCount++;
                if (loadedCount === images.length) {
                  setTimeout(() => { window.print(); window.close(); }, 300);
                }
              }
            }
          }
          if (loadedCount === images.length) {
            setTimeout(() => { window.print(); window.close(); }, 300);
          }
        } else {
          setTimeout(() => { window.print(); window.close(); }, 300);
        }
      };
    </script>
    </body></html>`
  }

  const printReceipt = () => {
    const win = window.open('', '_blank')
    win.document.write(buildReceiptHTML(lastReceipt, false))
    win.document.close()
  }

  const printQuotation = () => {
    const customer = customers.find(c => String(c.id) === String(customerId))
    const sub = cart.reduce((s, i) => s + i.custom_price * i.qty, 0)
    const disc = parseFloat(discount) || 0
    const tot = Math.max(0, sub - disc)
    const win = window.open('', '_blank')
    win.document.write(buildReceiptHTML({ items: cart, customer, subtotal: sub, totalDiscount: disc, total: tot, paymentType }, true))
    win.document.close(); win.print()
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 overflow-hidden" style={{ height: 'calc(100vh - 112px)' }}>

      {/* LEFT: Products */}
      <div className="flex-1 flex flex-col gap-3 min-w-0">

        {/* Sale / Quotation toggle */}
        <div className="flex gap-2">
          <button onClick={() => setSaleType('sale')}
            className={`flex-1 py-2 rounded-lg font-semibold text-sm transition ${saleType === 'sale' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border'}`}>
            🧾 Sale
          </button>
          <button onClick={() => setSaleType('quotation')}
            className={`flex-1 py-2 rounded-lg font-semibold text-sm transition ${saleType === 'quotation' ? 'bg-purple-600 text-white' : 'bg-white text-gray-600 border'}`}>
            📄 Quotation
          </button>
          <button onClick={() => setShowQuotationSearch(true)}
            className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-semibold text-sm border border-transparent transition">
            🔍 Search Quotation
          </button>
        </div>

        {/* Search + Filters */}
        <div className="flex gap-2 flex-wrap">
          <input type="text" placeholder="🔍 Product / Brand search..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0" />
          <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none">
            <option value="">All Categories</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={selectedBrand} onChange={e => setSelectedBrand(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none">
            <option value="">All Brands</option>
            {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
          {selectedBrand && (
            <button onClick={() => setShowBrandDiscount(true)}
              className="px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm transition whitespace-nowrap">
              % Brand Discount
            </button>
          )}
        </div>

        {/* Product Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 overflow-y-auto flex-1 content-start">
          {filtered.length === 0 && <p className="text-gray-400 col-span-3 text-center py-10">No products found</p>}
          {filtered.map(p => (
            <button key={p.id} onClick={() => addToCart(p)}
              className="bg-white rounded-xl shadow p-3 text-left hover:shadow-md hover:bg-blue-50 transition border border-transparent hover:border-blue-300 h-fit">
              <p className="font-semibold text-gray-800 text-sm leading-tight">{p.name}</p>
              {p.brand && <p className="text-xs text-gray-400">{p.brand}</p>}
              {p.categories?.name && <p className="text-xs text-gray-400">{p.categories.name}</p>}
              <p className="text-blue-600 font-bold mt-1 text-sm">Rs. {p.sale_price}</p>
              <p className="text-xs text-gray-400">Stock: {p.stock_quantity}</p>
              {(user.role === 'admin' || user.role === 'manager') && (
                <p className="text-xs text-gray-300 mt-1">Cost: {p.cost_price}</p>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Mobile Cart Floating Badge */}
      {cart.length > 0 && (
        <button
          onClick={() => setShowMobileCart(true)}
          className="md:hidden fixed bottom-5 right-5 z-40 bg-blue-600 text-white rounded-full w-16 h-16 flex flex-col items-center justify-center shadow-2xl hover:bg-blue-700 transition active:scale-95"
        >
          <span className="text-lg">🛒</span>
          <span className="text-[10px] font-black">{cart.length}</span>
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-black w-6 h-6 rounded-full flex items-center justify-center">Rs.{total.toFixed(0)}</span>
        </button>
      )}

      {/* RIGHT: Cart — hidden on mobile, overlay when toggled */}
      {/* Mobile overlay backdrop */}
      {showMobileCart && (
        <div className="md:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setShowMobileCart(false)} />
      )}
      <div className={`${showMobileCart ? 'fixed inset-0 z-50 w-full flex' : 'hidden md:flex'} md:static md:w-80 flex-col gap-2 bg-white rounded-xl shadow p-4 h-full overflow-hidden`}>

        {/* Mobile close button */}
        <button onClick={() => setShowMobileCart(false)} className="md:hidden self-end text-gray-400 hover:text-gray-700 text-2xl font-bold mb-1">✕</button>

        <h2 className="text-base font-bold text-gray-800 border-b pb-2 shrink-0 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span>🛒 Cart</span>
            {saleType === 'quotation' && <span className="text-purple-600 text-xs">(Quotation)</span>}
          </div>
          {heldCarts.length > 0 && (
            <button
              onClick={() => setShowHeldCarts(true)}
              className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-[10px] font-bold uppercase hover:bg-orange-200 transition"
            >
              ⏸️ Held ({heldCarts.length})
            </button>
          )}
          <button
            onClick={() => setShowQuickView(true)}
            className="px-2 py-0.5 bg-blue-100 text-blue-600 rounded text-[10px] font-black uppercase hover:bg-blue-200 transition"
          >
            🔍 Quick View
          </button>
        </h2>

        {/* Customer */}
        <select value={customerId} onChange={e => setCustomerId(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shrink-0">
          <option value="">Walk-in Customer</option>
          {customers.map(c => (
            <option key={c.id} value={c.id}>
              {c.name} {c.outstanding_balance > 0 ? `(Rs.${c.outstanding_balance} udhar)` : ''}
            </option>
          ))}
        </select>

        {!customerId && (
          <input
            type="text"
            placeholder="Customer Name (Optional)?"
            value={walkInName}
            onChange={e => setWalkInName(e.target.value)}
            className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 shrink-0 bg-blue-50"
          />
        )}

        {/* Cart Items — scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-1 pr-1 custom-scrollbar">
          {cart.length === 0 && <p className="text-gray-400 text-xs text-center py-8">Left side sy products add karo</p>}
          {cart.map(item => (
            <div key={item.id} className="bg-gray-50 rounded-lg p-2">
              <div className="flex items-center gap-1">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">{item.name}</p>
                  {item.brand && <p className="text-xs text-gray-400">{item.brand}</p>}
                </div>
                <input type="number" value={item.qty} onChange={e => updateQty(item.id, e.target.value)}
                  className="w-12 px-1 py-1 border rounded text-center text-xs" min="1" />
                <button onClick={() => removeFromCart(item.id)} className="text-red-400 hover:text-red-600 font-bold pl-1">×</button>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-gray-400">Rs.</span>
                <input type="number" value={item.custom_price} onChange={e => updatePrice(item.id, e.target.value)}
                  className="w-20 px-1 py-0.5 border border-blue-200 rounded text-xs text-blue-700 font-semibold" />
                <span className="text-xs text-gray-500 ml-auto">= Rs. {(item.custom_price * item.qty).toFixed(0)}</span>
              </div>
              {(user.role === 'admin' || user.role === 'manager' || user.role === 'accountant') && (
                <p className="text-xs text-green-600 mt-0.5">
                  Profit: Rs. {((item.custom_price - (item.cost_price || 0)) * item.qty).toFixed(0)}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Bottom section — fixed */}
        <div className="shrink-0 space-y-1 border-t pt-1">

          {/* Totals & Discount Mini-Grid */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span><span>Rs.{subtotal.toFixed(0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-gray-600">Disc (Rs):</label>
                <input type="number" value={discount} onChange={e => setDiscount(e.target.value)} className="w-16 px-1 border rounded text-right" min="0" placeholder="0" />
              </div>
            </div>
            <div className="flex flex-col justify-end text-right border-l pl-2 border-gray-100">
              <div className="text-gray-500 text-[10px] uppercase">Net Total</div>
              <div className="font-black text-lg text-gray-800 leading-none">Rs.{total.toFixed(0)}</div>
              {(user.role === 'admin' || user.role === 'manager' || user.role === 'accountant') && totalProfit !== 0 && (
                <div className={`text-[9px] mt-1 ${totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>Profit: {totalProfit.toFixed(0)}</div>
              )}
            </div>
          </div>

          {/* Received & Payment Types */}
          {saleType === 'sale' && (
            <div className="flex flex-col gap-1 bg-blue-50/50 p-1.5 rounded-lg border border-blue-100/50">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-blue-700">Cash/Recv</label>
                <div className="flex gap-1 items-center">
                  <span className="text-[9px] font-bold text-gray-500">{
                    Number(receivedAmount) > total ? `Change: ${(Number(receivedAmount) - total).toFixed(0)}`
                      : (Number(receivedAmount) < total && receivedAmount !== '') ? `Bal: ${(total - Number(receivedAmount)).toFixed(0)}`
                        : 'Full'
                  }</span>
                  <input
                    type="number"
                    value={receivedAmount}
                    onChange={e => {
                      const val = e.target.value;
                      setReceivedAmount(val);
                      if (val !== '' && Number(val) < total) setPaymentType('partial');
                      else if (val !== '' && Number(val) >= total) setPaymentType('cash');
                    }}
                    placeholder={total.toFixed(0)}
                    className="w-20 px-1 py-0.5 border border-blue-300 rounded text-right font-bold text-blue-700 focus:ring-1 focus:ring-blue-500 outline-none text-xs"
                  />
                </div>
              </div>

              <div className="flex gap-1 mt-0.5">
                <button onClick={() => { setPaymentType('cash'); setReceivedAmount(total.toString()) }}
                  className={`flex-1 py-1 rounded font-bold text-[9px] uppercase transition ${paymentType === 'cash' ? 'bg-green-600 text-white' : 'bg-white text-gray-500 border'}`}>
                  Cash
                </button>
                <button onClick={() => { setPaymentType('credit'); setReceivedAmount('0') }}
                  className={`flex-1 py-1 rounded font-bold text-[9px] uppercase transition ${paymentType === 'credit' ? 'bg-orange-500 text-white' : 'bg-white text-gray-500 border'}`}>
                  Udhaar
                </button>
                <button onClick={() => { setPaymentType('split'); setShowPaymentModal(true); if (payments.length === 0) setPayments([{ method: 'cash', amount: total }]) }}
                  className={`flex-1 py-1 rounded font-bold text-[9px] uppercase transition ${paymentType === 'split' ? 'bg-purple-600 text-white' : 'bg-white text-gray-500 border'}`}>
                  Split
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-1 pt-1">
            <button onClick={handleHoldBill} disabled={cart.length === 0}
              className="px-2 py-1.5 bg-orange-100 text-orange-700 rounded-lg text-xs font-bold transition disabled:opacity-50">
              ⏸️
            </button>
            <button onClick={clearCart}
              className="px-2 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs transition">
              🗑️
            </button>
            <button onClick={handleCompleteSale} disabled={saving || cart.length === 0}
              className={`flex-1 py-1.5 text-white text-sm font-bold rounded-lg transition disabled:opacity-50 ${saleType === 'quotation' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
              {saving ? '...' : saleType === 'quotation' ? 'Print Quote' : '✅ Complete Sale'}
            </button>
          </div>
        </div>
      </div>

      {/* Brand Discount Modal */}
      {showBrandDiscount && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-80">
            <h3 className="font-bold text-gray-800 mb-4">🏷️ {selectedBrand} — Brand Discount</h3>
            <p className="text-xs text-gray-500 mb-3">Is brand ke tamam products cart mein add honge discount ke saath.</p>
            <div className="flex gap-2 mb-3">
              <button onClick={() => setBrandDiscountType('percent')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${brandDiscountType === 'percent' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                % Percent
              </button>
              <button onClick={() => setBrandDiscountType('fixed')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${brandDiscountType === 'fixed' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                Rs. Fixed
              </button>
            </div>
            <input type="number" value={brandDiscountValue} onChange={e => setBrandDiscountValue(e.target.value)}
              placeholder={brandDiscountType === 'percent' ? 'e.g. 10 (%)' : 'e.g. 50 (Rs.)'}
              className="w-full px-4 py-2 border rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <div className="flex gap-3">
              <button onClick={applyBrandDiscount} className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition">Apply & Add</button>
              <button onClick={() => setShowBrandDiscount(false)} className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt Modal */}
      {lastReceipt && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-96">
            <div className="text-center mb-4">
              <div className="text-4xl mb-1">✅</div>
              <h2 className="text-xl font-bold text-gray-800">Sale Complete!</h2>
              <p className="text-gray-500 text-sm">{lastReceipt.paymentType === 'credit' ? '📒 Udhaar sale' : '💵 Cash sale'}</p>
              {form.logo_url && (
                <div className="mt-2 flex justify-center">
                  <img src={form.logo_url} alt="Logo Preview" className="h-10 object-contain opacity-50 sepia-[.5]" />
                </div>
              )}
            </div>
            <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm space-y-1">
              {lastReceipt.items.map(i => (
                <div key={i.id} className="flex justify-between text-xs">
                  <span>{i.name} × {i.qty} @ Rs.{i.custom_price}</span>
                  <span>Rs. {(i.custom_price * i.qty).toFixed(0)}</span>
                </div>
              ))}
              <div className="border-t pt-1 flex justify-between font-bold">
                <span>Total</span><span>Rs. {lastReceipt.total.toFixed(0)}</span>
              </div>
              {(user.role === 'admin' || user.role === 'manager' || user.role === 'accountant') && (
                <div className={`flex justify-between text-xs ${lastReceipt.totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  <span>Profit</span><span>Rs. {lastReceipt.totalProfit.toFixed(0)}</span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex gap-3">
                <button onClick={printReceipt} className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition">🖨️ Print</button>
                {lastReceipt.customer?.phone && (
                  <button
                    onClick={() => {
                      const phone = lastReceipt.customer.phone.replace(/[^0-9]/g, '')
                      let formattedPhone = phone
                      if (phone.startsWith('03')) formattedPhone = '92' + phone.substring(1)
                      else if (phone.length === 10) formattedPhone = '92' + phone

                      const template = form.wa_bill_template || 'Hello [Name], thank you for shopping at [Shop Name]! Your bill summary for Invoice #[ID] is Rs. [Amount]. Thank you for your business!'
                      const msg = template
                        .replace(/\[Name\]/g, lastReceipt.customer.name || 'Customer')
                        .replace(/\[Amount\]/g, lastReceipt.total.toFixed(0))
                        .replace(/\[Shop Name\]/g, form.name || 'our shop')
                        .replace(/\[ID\]/g, String(lastReceipt.sale.id).slice(-8))

                      window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`, '_blank')
                    }}
                    className="flex-1 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition flex items-center justify-center gap-2"
                  >
                    <span>💬</span> WhatsApp
                  </button>
                )}
              </div>
              <button onClick={() => setLastReceipt(null)} className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition font-medium">Close</button>
            </div>
          </div>
        </div>
      )}
      {/* Quotation Search Modal */}
      {showQuotationSearch && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Search Quotation</h2>
            <p className="text-sm text-gray-500 mb-4">Quotation number (e.g. QT-abcd1234) enter karein jo bill par likha hai.</p>
            <div className="space-y-4">
              <input
                type="text"
                autoFocus
                placeholder="Last 8 digits or full ID..."
                value={quotationIdInput}
                onChange={e => setQuotationIdInput(e.target.value)}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
              />
              <div className="flex gap-3">
                <button
                  onClick={handleSearchQuotation}
                  className="flex-1 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg transition"
                >
                  Load to Cart
                </button>
                <button
                  onClick={() => setShowQuotationSearch(false)}
                  className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Held Carts Modal */}
      {showHeldCarts && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-800">⏸️ Held Bills</h2>
              <button onClick={() => setShowHeldCarts(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>
            <div className="max-height-[400px] overflow-y-auto space-y-3">
              {heldCarts.map(held => (
                <div key={held.id} className="p-4 border rounded-xl hover:border-blue-400 hover:bg-blue-50 transition cursor-pointer group" onClick={() => handleResumeCart(held)}>
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-bold text-gray-800">{held.customer_name || 'Walk-in Customer'}</p>
                      <p className="text-[10px] text-gray-400 uppercase font-bold tracking-tighter">
                        Saved: {new Date(held.saved_at).toLocaleTimeString()}
                      </p>
                    </div>
                    <p className="font-black text-blue-600">Rs. {held.total.toFixed(0)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {held.items.slice(0, 3).map((it, idx) => (
                      <span key={idx} className="text-[10px] bg-white border px-1.5 py-0.5 rounded text-gray-500">
                        {it.name} × {it.qty}
                      </span>
                    ))}
                    {held.items.length > 3 && <span className="text-[10px] text-gray-400 ml-1">+{held.items.length - 3} more</span>}
                  </div>
                  <button className="w-full mt-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold opacity-0 group-hover:opacity-100 transition">Resume Bill</button>
                </div>
              ))}
              {heldCarts.length === 0 && (
                <div className="text-center py-10 text-gray-400 italic">No held bills found</div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Split Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <h2 className="text-xl font-bold text-gray-800 mb-4">🔀 Split Payment</h2>
            <div className="space-y-3 mb-4 max-h-[300px] overflow-y-auto">
              {payments.map((p, idx) => (
                <div key={idx} className="flex gap-2 items-center bg-gray-50 p-2 rounded-lg">
                  <select
                    value={p.method}
                    onChange={(e) => {
                      const newP = [...payments]; newP[idx].method = e.target.value; setPayments(newP)
                    }}
                    className="flex-1 bg-white border rounded px-2 py-1 text-sm outline-none"
                  >
                    <option value="cash">Cash</option>
                    <option value="bank">Bank</option>
                    <option value="card">Card</option>
                  </select>
                  <input
                    type="number"
                    value={p.amount}
                    onChange={(e) => {
                      const newP = [...payments]; newP[idx].amount = e.target.value; setPayments(newP)
                    }}
                    className="w-24 border rounded px-2 py-1 text-sm"
                  />
                  <button onClick={() => setPayments(payments.filter((_, i) => i !== idx))} className="text-red-500 font-bold">×</button>
                </div>
              ))}
            </div>

            <div className="border-t pt-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span>Total Bill:</span><span className="font-bold">Rs. {total.toFixed(0)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Paid So Far:</span><span className="font-bold text-green-600">Rs. {payments.reduce((s, p) => s + Number(p.amount), 0).toFixed(0)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Remaining:</span>
                <span className={`font-bold ${total - payments.reduce((s, p) => s + Number(p.amount), 0) > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  Rs. {(total - payments.reduce((s, p) => s + Number(p.amount), 0)).toFixed(0)}
                </span>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => {
                  const remaining = total - payments.reduce((s, p) => s + Number(p.amount), 0)
                  setPayments([...payments, { method: 'bank', amount: Math.max(0, remaining) }])
                }}
                className="flex-1 py-1.5 border border-purple-200 text-purple-600 rounded-lg text-xs font-bold hover:bg-purple-50"
              >
                + Add Payment
              </button>
              <button onClick={() => setShowPaymentModal(false)} className="flex-1 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold">Done</button>
            </div>
          </div>
        </div>
      )}
      {/* Quick View Modal */}
      {showQuickView && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-4 shrink-0">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <span>🔍 Cart Quick View</span>
                <span className="text-sm font-normal text-gray-500">({cart.length} items)</span>
              </h2>
              <button onClick={() => setShowQuickView(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>

            <div className="flex-1 overflow-y-auto mb-4 border rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-50 sticky top-0 border-b">
                  <tr>
                    <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Product</th>
                    <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase text-center">Price (Rs.)</th>
                    <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase text-center">Quantity</th>
                    <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase text-right">Total (Rs.)</th>
                    <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {cart.map(item => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-800">{item.name}</p>
                        {item.brand && <p className="text-xs text-gray-400">{item.brand}</p>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input type="number" value={item.custom_price} onChange={e => updatePrice(item.id, e.target.value)}
                          className="w-24 px-2 py-1 border rounded text-center font-semibold text-blue-600 focus:ring-1 focus:ring-blue-500 outline-none" />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => updateQty(item.id, item.qty - 1)} className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200">-</button>
                          <input type="number" value={item.qty} onChange={e => updateQty(item.id, e.target.value)}
                            className="w-16 px-2 py-1 border rounded text-center focus:ring-1 focus:ring-blue-500 outline-none" min="1" />
                          <button onClick={() => updateQty(item.id, item.qty + 1)} className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200">+</button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-gray-800">
                        {(item.custom_price * item.qty).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => removeFromCart(item.id)} className="text-red-500 hover:text-red-700 font-bold p-2">🗑️</button>
                      </td>
                    </tr>
                  ))}
                  {cart.length === 0 && (
                    <tr><td colSpan="5" className="px-4 py-10 text-center text-gray-400 italic">Cart is empty</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="shrink-0 flex justify-between items-center p-4 bg-gray-50 rounded-xl border border-gray-100">
              <div className="space-y-1">
                <p className="text-gray-500 text-xs">Subtotal: Rs. {subtotal.toLocaleString()}</p>
                {totalDiscount > 0 && <p className="text-red-500 text-xs">Discount: - Rs. {totalDiscount.toLocaleString()}</p>}
                <p className="text-2xl font-black text-gray-800">Total: Rs. {total.toLocaleString()}</p>
              </div>
              <button onClick={() => setShowQuickView(false)} className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-100 transition">Return to POS</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default POS