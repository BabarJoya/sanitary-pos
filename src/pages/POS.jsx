import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db, addToSyncQueue } from '../services/db'
import { recordAuditLog } from '../services/auditService'
import { buildBillHTML } from '../utils/billTemplates'
import { hasFeature } from '../utils/featureGate'
import { generateBillPDF, shareOrDownloadPDF } from '../utils/pdfShare'
import { printHTML } from '../utils/printUtils'
import { getPricingConfig } from '../utils/businessPresets'
import { PAKISTANI_PAYMENT_PROVIDERS } from '../utils/paymentMethods'

function POS() {
  const { user } = useAuth()
  const pricingConfig = getPricingConfig(user?.shop_id)
  const [searchParams] = useSearchParams()

  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [customers, setCustomers] = useState([])
  const [brands, setBrands] = useState([])

  const [brandCategoryMap, setBrandCategoryMap] = useState({}) // brandId -> [categoryId,...]
  const [cardQtys, setCardQtys] = useState({}) // productId -> qty string

  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedBrand, setSelectedBrand] = useState('')

  const [cart, setCart] = useState([])
  const [customerId, setCustomerId] = useState('')
  const [walkInName, setWalkInName] = useState('')
  const [paymentType, setPaymentType] = useState('cash')
  const [onlineProvider, setOnlineProvider] = useState('jazzcash')
  const [transactionRef, setTransactionRef] = useState('')
  const searchInputRef = useRef(null)
  const [receivedAmount, setReceivedAmount] = useState('') // New state for partial payments
  const [payments, setPayments] = useState([]) // [{method, amount}]
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [discount, setDiscount] = useState(0)
  const [discountMode, setDiscountMode] = useState('fixed') // 'fixed' | 'percent'
  const [discountPercent, setDiscountPercent] = useState('')
  const [saleType, setSaleType] = useState('sale')

  const subtotal = cart.reduce((sum, i) => sum + i.custom_price * i.qty, 0)
  const totalDiscount = discountMode === 'percent'
    ? Math.round((subtotal * (parseFloat(discountPercent) || 0)) / 100 * 100) / 100
    : parseFloat(discount) || 0
  const total = Math.max(0, subtotal - totalDiscount)
  const totalProfit = cart.reduce((sum, i) => sum + (i.custom_price - (i.cost_price || 0)) * i.qty, 0) - totalDiscount
  const [saving, setSaving] = useState(false)
  const [lastReceipt, setLastReceipt] = useState(null)
  const [showQuotationSearch, setShowQuotationSearch] = useState(false)
  const [quotationIdInput, setQuotationIdInput] = useState('')
  const [form, setForm] = useState(() => {
    const sid = user?.shop_id
    const saved = sid ? localStorage.getItem(`shop_settings_${sid}`) : null
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) { /* fallback */ }
    }
    return {
      name: (sid ? localStorage.getItem(`shop_name_${sid}`) : null) || 'EdgeX POS',
      phone: '',
      address: '',
      invoice_footer: 'شکریہ! دوبارہ تشریف لائیں',
      quotation_footer: 'یہ صرف قیمت نامہ ہے',
      print_size: 'thermal',
      print_mode: 'manual',
      logo_url: (sid ? localStorage.getItem(`shop_logo_${sid}`) : null) || '',
      wa_reminder_template: 'Hello [Name], this is a reminder from [Shop Name] regarding your outstanding balance of Rs. [Amount]. Please clear your dues at your earliest convenience. Thank you!',
      wa_bill_template: 'Hello [Name], thank you for shopping at [Shop Name]! Your bill summary for Invoice #[ID] is Rs. [Amount]. Thank you for your business!'
    }
  })

  // Barcode scanner mode
  const [barcodeMode, setBarcodeMode] = useState(false) // Off by default — user must click to enable
  const [barcodeInput, setBarcodeInput] = useState('')
  const barcodeRef = useRef(null)

  useEffect(() => {
    if (barcodeMode && barcodeRef.current) barcodeRef.current.focus()
  }, [barcodeMode])

  // When barcode mode is active, route physical scanner keystrokes to the hidden input.
  // Only active after the user explicitly enables barcode mode via the toggle button.
  useEffect(() => {
    if (!barcodeMode) return; // Do nothing when barcode mode is off

    const handleGlobalKeyDown = (e) => {
      const activeEl = document.activeElement;
      // If any real input/select already has focus, let it handle the keystroke normally
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
         activeEl.tagName === 'TEXTAREA' ||
         activeEl.tagName === 'SELECT' ||
         activeEl.isContentEditable)
      ) {
        if (activeEl === barcodeRef.current) return;
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1) {
        setBarcodeInput(prev => prev + e.key);
        if (barcodeRef.current && activeEl !== barcodeRef.current) {
          barcodeRef.current.focus()
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [barcodeMode]);

  const handleBarcodeSubmit = (e) => {
    e.preventDefault()
    const rawSku = barcodeInput.trim()
    if (!rawSku) return
    const skuLower = rawSku.toLowerCase()
    const cleanSku = rawSku.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()

    const product = products.find(p => {
      const pSku = String(p.sku || '').trim().toLowerCase()
      const pId = String(p.id || '').trim()
      const pName = String(p.name || '').trim().toLowerCase()
      const cleanPSku = pSku.replace(/[^a-zA-Z0-9]/g, '')

      return (
        (pSku && (pSku === skuLower || cleanPSku === cleanSku)) ||
        (pId && pId === rawSku) ||
        (pName && pName === skuLower)
      )
    })

    if (product) {
      addToCart(product)
    } else {
      try {
        const beep = new AudioContext()
        const osc = beep.createOscillator()
        osc.connect(beep.destination)
        osc.frequency.value = 200
        osc.start(); osc.stop(beep.currentTime + 0.15)
      } catch (_) {}
      alert(`❌ SKU / Barcode "${rawSku}" — product not found. Add SKU in Products page.`)
    }
    setBarcodeInput('')
    setTimeout(() => barcodeRef.current?.focus(), 50)
  }

  // Save walk-in as customer
  const [showSaveCustomer, setShowSaveCustomer] = useState(false)
  const [saveCustomerForm, setSaveCustomerForm] = useState({ name: '', mobile: '' })
  const [savingCustomer, setSavingCustomer] = useState(false)

  // Brand bulk discount modal
  const [showBrandDiscount, setShowBrandDiscount] = useState(false)
  const [brandDiscountType, setBrandDiscountType] = useState('percent')
  const [brandDiscountValue, setBrandDiscountValue] = useState('')
  const [brandDiscountMode, setBrandDiscountMode] = useState('cart_only') // 'cart_only' or 'add_all'

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
      .maybeSingle()

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
    if (!user?.shop_id) {
      console.error('POS: Missing user.shop_id!')
      return
    }

    const sid = String(user.shop_id)

    // ── Step 1: Show local IndexedDB data IMMEDIATELY (instant UI) ────────────
    try {
      const [lProds, lCats, lCustomers, lBrands, lBrandCats] = await Promise.all([
        db.products.toArray(),
        db.categories.toArray(),
        db.customers.toArray(),
        db.brands.toArray(),
        db.brand_categories.toArray().catch(() => [])
      ])
      const myProds = lProds.filter(x => String(x.shop_id) === sid)
      const myCats = lCats.filter(x => String(x.shop_id) === sid)
      const myCustomers = lCustomers.filter(x => String(x.shop_id) === sid)
      const myBrands = lBrands.filter(x => String(x.shop_id) === sid)
      const myBrandCats = lBrandCats.filter(x => String(x.shop_id) === sid)
      const bcMap = {}
      myBrandCats.forEach(bc => {
        if (!bcMap[bc.brand_id]) bcMap[bc.brand_id] = []
        bcMap[bc.brand_id].push(bc.category_id)
      })
      setProducts(myProds)
      setCategories(myCats)
      setCustomers(myCustomers)
      setBrands(myBrands)
      setBrandCategoryMap(bcMap)
    } catch (localErr) {
      console.warn('POS: Local DB read failed:', localErr)
    }

    // ── Step 2: Background refresh from Supabase (updates UI silently) ────────
    if (!navigator.onLine) return;
    try {
      const [p, c, cu, b, s] = await Promise.all([
        supabase.from('products').select('*, categories(name)').eq('shop_id', user.shop_id).or('status.eq.active,status.is.null'),
        supabase.from('categories').select('*').eq('shop_id', user.shop_id),
        supabase.from('customers').select('*').eq('shop_id', user.shop_id).order('name'),
        supabase.from('brands').select('*').eq('shop_id', user.shop_id).order('name'),
        supabase.from('shops').select('*').eq('id', user.shop_id).maybeSingle()
      ])

      if (p.data) await db.products.bulkPut(JSON.parse(JSON.stringify(p.data)))
      if (c.data) await db.categories.bulkPut(JSON.parse(JSON.stringify(c.data)))
      if (cu.data) await db.customers.bulkPut(JSON.parse(JSON.stringify(cu.data)))
      if (b.data) await db.brands.bulkPut(JSON.parse(JSON.stringify(b.data)))

      if (s.data) {
        setForm(prev => {
          const localLogo = localStorage.getItem(`shop_logo_${user?.shop_id}`) || ''
          return {
            ...prev,
            name: s.data.name || prev.name,
            phone: s.data.phone || prev.phone,
            address: s.data.address || prev.address,
            invoice_footer: s.data.invoice_footer || prev.invoice_footer,
            quotation_footer: s.data.quotation_footer || prev.quotation_footer,
            print_size: s.data.print_size || prev.print_size,
            print_mode: s.data.print_mode || prev.print_mode,
            logo_url: localLogo || s.data.logo_url || prev.logo_url || '',
            wa_reminder_template: s.data.wa_reminder_template || prev.wa_reminder_template,
            wa_bill_template: s.data.wa_bill_template || prev.wa_bill_template
          }
        })
      }

      // Re-render from merged local DB (cloud data + any pending offline records)
      const [lProds, lCats, lCustomers, lBrands, lBrandCats] = await Promise.all([
        db.products.toArray(),
        db.categories.toArray(),
        db.customers.toArray(),
        db.brands.toArray(),
        db.brand_categories.toArray().catch(() => [])
      ])

      const sid = String(user.shop_id);
      const myProds = lProds.filter(x => String(x.shop_id) === sid)
      const myCats = lCats.filter(x => String(x.shop_id) === sid)
      const myCustomers = lCustomers.filter(x => String(x.shop_id) === sid)
      const myBrands = lBrands.filter(x => String(x.shop_id) === sid)
      const myBrandCats = lBrandCats.filter(x => String(x.shop_id) === sid)
      const bcMap = {}
      myBrandCats.forEach(bc => {
        if (!bcMap[bc.brand_id]) bcMap[bc.brand_id] = []
        bcMap[bc.brand_id].push(bc.category_id)
      })

      setProducts(myProds)
      setCategories(myCats)
      setCustomers(myCustomers)
      setBrands(myBrands)
      setBrandCategoryMap(bcMap)
    } catch (e) {
      console.log('POS: Fetching from local DB (Offline Fallback)')
      try {
        const [lProds, lCats, lCustomers, lBrands, lBrandCats] = await Promise.all([
          db.products.toArray(),
          db.categories.toArray(),
          db.customers.toArray(),
          db.brands.toArray(),
          db.brand_categories.toArray().catch(() => [])
        ])

        // Filter locally for shop_id just in case, ensuring type safety
        const sid = String(user.shop_id);
        const myProds = lProds.filter(x => String(x.shop_id) === sid)
        const myCats = lCats.filter(x => String(x.shop_id) === sid)
        const myCustomers = lCustomers.filter(x => String(x.shop_id) === sid)
        const myBrands = lBrands.filter(x => String(x.shop_id) === sid)
        const myBrandCats = lBrandCats.filter(x => String(x.shop_id) === sid)
        const bcMap = {}
        myBrandCats.forEach(bc => {
          if (!bcMap[bc.brand_id]) bcMap[bc.brand_id] = []
          bcMap[bc.brand_id].push(bc.category_id)
        })

        setProducts(myProds)
        setCategories(myCats)
        setCustomers(myCustomers)
        setBrands(myBrands)
        setBrandCategoryMap(bcMap)

        // Load shop settings from local DB too
        const sidNumber = Number(user.shop_id)
        const localShop = await db.shops.get(sidNumber)
        if (localShop) {
          setForm(prev => {
            const localLogo = localStorage.getItem(`shop_logo_${user?.shop_id}`) || ''
            return {
              ...prev,
              name: localShop.name || prev.name,
              phone: localShop.phone || prev.phone,
              address: localShop.address || prev.address,
              logo_url: localLogo || localShop.logo_url || prev.logo_url || '',
              invoice_footer: localShop.invoice_footer || prev.invoice_footer,
              quotation_footer: localShop.quotation_footer || prev.quotation_footer,
              print_size: localShop.print_size || prev.print_size,
              print_mode: localShop.print_mode || prev.print_mode,
              wa_reminder_template: localShop.wa_reminder_template || prev.wa_reminder_template,
              wa_bill_template: localShop.wa_bill_template || prev.wa_bill_template
            }
          })
        }
      } catch (err) { console.error('Local DB POS Error', err) }
    }
  }

  // Union of brands from brands table AND products to guarantee zero missing brands
  const displayBrands = Array.from(new Set([
    ...brands.map(b => b.name?.trim()),
    ...products.map(p => p.brand?.trim())
  ])).filter(Boolean).sort((a, b) => a.localeCompare(b))

  // Filter categories by selected brand (brand-category link)
  const brandObj = brands.find(b => b.name?.toLowerCase() === selectedBrand?.trim().toLowerCase())
  const posCategories = brandObj && brandCategoryMap[brandObj.id]?.length
    ? categories.filter(c => brandCategoryMap[brandObj.id].includes(c.id))
    : categories

  // Reset selectedCategory if it's not in the filtered list
  useEffect(() => {
    if (selectedCategory && brandObj && brandCategoryMap[brandObj.id]?.length) {
      const allowed = brandCategoryMap[brandObj.id].map(String)
      if (!allowed.includes(String(selectedCategory))) setSelectedCategory('')
    }
  }, [selectedBrand])

  // Counter Keyboard Shortcuts (F2: search, F4: cash, Esc: clear/dismiss)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'F2') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      } else if (e.key === 'F4') {
        e.preventDefault()
        setPaymentType('cash')
        setReceivedAmount(total.toString())
      } else if (e.key === 'Escape') {
        if (showPaymentModal) setShowPaymentModal(false)
        else if (showQuickView) setShowQuickView(false)
        else if (showBrandDiscount) setShowBrandDiscount(false)
        else if (search) setSearch('')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [total, showPaymentModal, showQuickView, showBrandDiscount, search])

  const categoryNameMap = categories.reduce((acc, c) => {
    acc[String(c.id)] = c.name
    return acc
  }, {})

  const filtered = products.filter(p => {
    const q = search.trim().toLowerCase()
    let matchSearch = true
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean)
      const pName = String(p.name || '').toLowerCase()
      const pBrand = String(p.brand || '').toLowerCase()
      const pSku = String(p.sku || '').toLowerCase()
      const pId = String(p.id || '').toLowerCase()
      const pCat = String(categoryNameMap[String(p.category_id)] || p.categories?.name || '').toLowerCase()
      const searchTarget = `${pName} ${pBrand} ${pSku} ${pId} ${pCat}`

      matchSearch = tokens.every(token => searchTarget.includes(token))
    }
    const matchCat = selectedCategory ? String(p.category_id) === String(selectedCategory) : true
    const matchBrand = selectedBrand ? String(p.brand) === String(selectedBrand) : true
    return matchSearch && matchCat && matchBrand
  })

  const addToCart = (product, qty = 1) => {
    const parsedQty = parseFloat(qty)
    const addQty = isNaN(parsedQty) || parsedQty <= 0 ? 1 : parsedQty
    setCart(prev => {
      const existing = prev.find(i => i.id === product.id)
      if (existing) {
        const newQty = Math.round((existing.qty + addQty) * 1000) / 1000
        if (newQty > product.stock_quantity) { alert('Not enough stock!'); return prev }
        return prev.map(i => i.id === product.id ? { ...i, qty: newQty } : i)
      }
      const clampedQty = Math.min(addQty, product.stock_quantity)
      return [{ ...product, qty: clampedQty, custom_price: product.sale_price }, ...prev]
    })
  }

  const updateQty = (id, qty) => {
    const num = parseFloat(qty)
    if (isNaN(num) || num <= 0) return
    const product = products.find(p => p.id === id)
    if (product && num > product.stock_quantity) { alert('Not enough stock!'); return }
    setCart(prev => prev.map(i => i.id === id ? { ...i, qty: num } : i))
  }

  const updatePrice = (id, price) => {
    const num = parseFloat(price)
    if (isNaN(num) || num < 0) return
    setCart(prev => prev.map(i => i.id === id ? { ...i, custom_price: num } : i))
  }

  const handleFixedDiscountChange = (val) => {
    setDiscount(val)
    const num = parseFloat(val)
    if (!isNaN(num) && subtotal > 0) {
      setDiscountPercent(((num / subtotal) * 100).toFixed(1))
    } else {
      setDiscountPercent('')
    }
  }

  const handlePercentDiscountChange = (val) => {
    setDiscountPercent(val)
    const num = parseFloat(val)
    if (!isNaN(num) && subtotal > 0) {
      const rs = Math.round((subtotal * num) / 100)
      setDiscount(rs.toString())
    } else {
      setDiscount('0')
    }
  }

  const removeFromCart = (id) => setCart(prev => prev.filter(i => i.id !== id))

  const clearCart = () => {
    setCart([]); setCustomerId(''); setWalkInName(''); setPaymentType('cash'); setReceivedAmount(''); setPayments([]); setDiscount(0); setDiscountPercent(''); setDiscountMode('fixed')
  }

  const handleSaveCustomer = async () => {
    const name = saveCustomerForm.name.trim()
    if (!name) return alert('Customer ka naam zaroor darj karein')
    setSavingCustomer(true)
    const newCustomer = {
      name,
      phone: saveCustomerForm.mobile.trim(),
      shop_id: user.shop_id,
      outstanding_balance: 0,
      created_at: new Date().toISOString()
    }
    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')
      const { data, error } = await supabase.from('customers').insert([newCustomer]).select()
      if (error) throw error
      const saved = data[0]
      await db.customers.put(JSON.parse(JSON.stringify(saved)))
      setCustomers(prev => [...prev, saved])
      setCustomerId(String(saved.id))
      setWalkInName('')
      setShowSaveCustomer(false)
      setSaveCustomerForm({ name: '', mobile: '' })
    } catch (err) {
      const errMsg = err?.message || String(err)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        const localCust = { ...newCustomer, id: crypto.randomUUID() }
        await db.customers.add(localCust)
        await addToSyncQueue('customers', 'INSERT', localCust)
        setCustomers(prev => [...prev, localCust])
        setCustomerId(String(localCust.id))
        setWalkInName('')
        setShowSaveCustomer(false)
        setSaveCustomerForm({ name: '', mobile: '' })
        alert('Offline: Customer locally save hua. Online hone par sync hoga.')
      } else {
        alert('Error: ' + errMsg)
      }
    } finally {
      setSavingCustomer(false)
    }
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

    // Check for loss items before applying
    const lossItems = []
    brandProducts.forEach(product => {
      const isInCart = cart.find(i => i.id === product.id)
      if (brandDiscountMode === 'cart_only' && !isInCart) return
      const cRate = parseFloat(product.c_rate) || 0
      let discountedPrice
      if (brandDiscountType === 'percent' && cRate > 0) {
        const currentPrice = isInCart ? isInCart.custom_price : product.sale_price
        const currentDiscPct = (1 - currentPrice / cRate) * 100
        discountedPrice = cRate * (1 - (currentDiscPct + val) / 100)
      } else if (brandDiscountType === 'percent') {
        const currentPrice = isInCart ? isInCart.custom_price : product.sale_price
        discountedPrice = currentPrice - (currentPrice * val / 100)
      } else {
        const currentPrice = isInCart ? isInCart.custom_price : product.sale_price
        discountedPrice = currentPrice - val
      }
      discountedPrice = Math.max(0, parseFloat(discountedPrice.toFixed(2)))
      const costPrice = parseFloat(product.cost_price) || 0
      if (discountedPrice < costPrice) {
        lossItems.push({ name: product.name, cRate, costPrice, discountedPrice })
      }
    })

    if (lossItems.length > 0) {
      const details = lossItems.map(({ name, cRate, costPrice, discountedPrice }) =>
        `• ${name}${cRate > 0 ? ` (C.Rate: Rs.${cRate})` : ''} | Purchase: Rs.${costPrice} | Discount Price: Rs.${discountedPrice}`
      ).join('\n')
      const confirmed = window.confirm(
        `⚠️ Nuqsan (Loss) Alert!\n\nYeh brand discount apply karne se in products par nuqsan hoga:\n${details}\n\nPhir bhi apply karein?`
      )
      if (!confirmed) return
    }

    setCart(prev => {
      let updated = [...prev]
      brandProducts.forEach(product => {
        const cRate = parseFloat(product.c_rate) || 0
        const isInCart = updated.find(i => i.id === product.id)

        // In cart-only mode, skip products not already in the cart
        if (brandDiscountMode === 'cart_only' && !isInCart) return

        let discountedPrice
        if (brandDiscountType === 'percent' && cRate > 0) {
          // c_rate-based calculation:
          // 1. Find current discount% from c_rate that custom_price (or sale_price) represents
          const currentPrice = isInCart ? isInCart.custom_price : product.sale_price
          const currentDiscPct = (1 - currentPrice / cRate) * 100
          // 2. Add the brand discount %
          const newDiscPct = currentDiscPct + val
          // 3. New price = c_rate * (1 - newDiscPct / 100)
          discountedPrice = cRate * (1 - newDiscPct / 100)
        } else if (brandDiscountType === 'percent') {
          // Fallback if c_rate is 0: apply % on sale_price
          const currentPrice = isInCart ? isInCart.custom_price : product.sale_price
          discountedPrice = currentPrice - (currentPrice * val / 100)
        } else {
          // Fixed amount discount
          const currentPrice = isInCart ? isInCart.custom_price : product.sale_price
          discountedPrice = currentPrice - val
        }
        discountedPrice = Math.max(0, parseFloat(discountedPrice.toFixed(2)))

        if (isInCart) {
          updated = updated.map(i => i.id === product.id ? { ...i, custom_price: discountedPrice } : i)
        } else {
          // Only reached in 'add_all' mode
          updated = [...updated, { ...product, qty: 1, custom_price: discountedPrice }]
        }
      })
      return updated
    })
    setShowBrandDiscount(false)
    setBrandDiscountValue('')
  }

  const handleCompleteSale = async () => {
    if (cart.length === 0) { alert('Cart khali hai!'); return }

    // If split payment not used, default to single payment
    const singleMethod = paymentType === 'online' ? onlineProvider : paymentType
    const finalPayments = payments.length > 0
      ? payments
      : [{
          method: singleMethod,
          provider: paymentType === 'online' ? onlineProvider : null,
          ref: paymentType === 'online' ? transactionRef : null,
          amount: (receivedAmount === '' ? total : Number(receivedAmount))
        }]
    const totalPaid = finalPayments.reduce((s, p) => s + Number(p.amount), 0)

    if ((paymentType === 'credit' || totalPaid < total) && !customerId) {
      alert('Balance amount (Credit) ke liye customer select karna zaroori hai!');
      return
    }

    setSaving(true)

    // Sanitize integer FK — offline-created customers have UUID ids
    const toIntOrNull = (v) => { const n = parseInt(v); return isNaN(n) ? null : n }

    const primaryPaymentMethod = saleType === 'quotation'
      ? 'quotation'
      : (finalPayments.length > 1 ? 'split' : singleMethod)

    // Generate Sale Object
    const saleData = {
      shop_id: user.shop_id,
      customer_id: toIntOrNull(customerId),
      customer_name: customerId ? null : walkInName,
      total_amount: subtotal,
      discount: totalDiscount,
      paid_amount: saleType === 'quotation' ? 0 : totalPaid,
      payment_type: primaryPaymentMethod,
      payment_method: primaryPaymentMethod,
      sale_type: saleType,
      status: 'completed',
      created_by: user.username,
      created_at: new Date().toISOString()
    }

    // Include payment_details for split or online/ref metadata
    if (saleType !== 'quotation') {
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
        product_id: toIntOrNull(i.id),
        product_name: i.name,
        quantity: i.qty,
        unit_price: i.custom_price,
        cost_price: i.cost_price || 0,
        line_total: i.custom_price * i.qty,
        returned_qty: 0,
      }))
      const { data: resItems, error: itemsError } = await supabase.from('sale_items').insert(items).select()
      if (itemsError) throw itemsError

      // Mirror to local DB so Sales history / ledger shows up immediately without reload
      await db.sales.put(sale)
      await db.sale_items.bulkPut(resItems)

      if (saleType === 'sale') {
        for (const item of cart) {
          const newStock = item.stock_quantity - item.qty
          await supabase.from('products').update({ stock_quantity: newStock }).eq('id', item.id)
          // Mirror to local DB so Inventory page shows accurate stock immediately
          await db.products.update(item.id, { stock_quantity: newStock })
        }
        if (customerId) {
          // CLAMPED to avoid deducting cash change returned from customer's long-term ledger!
          const actualPaidToBill = Math.min(total, totalPaid)
          const balanceIncrease = total - actualPaidToBill
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

        await db.sales.add(offlineSaleData)
        await addToSyncQueue('sales', 'INSERT', offlineSaleData)

        const items = cart.map(i => ({
          id: crypto.randomUUID(),
          sale_id: offlineId,
          product_id: i.id,
          product_name: i.name,
          quantity: i.qty,
          unit_price: i.custom_price,
          cost_price: i.cost_price || 0,
          line_total: i.custom_price * i.qty,
          returned_qty: 0,
        }))
        await db.sale_items.bulkPut(items)
        await addToSyncQueue('sale_items', 'INSERT', items)

        if (saleType === 'sale') {
          // Update Local Stock
          for (const item of cart) {
            const newStock = item.stock_quantity - item.qty
            await db.products.update(item.id, { stock_quantity: newStock })
            await addToSyncQueue('products', 'UPDATE', { id: item.id, stock_quantity: newStock })
          }
          // Update Local Customer Balance (clamped)
          if (customerId) {
            const actualPaidToBill = Math.min(total, totalPaid)
            const balanceIncrease = total - actualPaidToBill
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
      printHTML(buildReceiptHTML({
        sale: finalSale, items: cart, customer, subtotal, totalDiscount, total, paymentType
      }, true))
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
      const { data, error } = await query.eq('id', parseInt(qId)).maybeSingle()
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
    // Always read shop settings fresh from localStorage at print time.
    // Uses shop_id-scoped keys for full multitenancy.
    const sid = user?.shop_id
    let saved = {}
    try { saved = JSON.parse((sid ? localStorage.getItem(`shop_settings_${sid}`) : null) || '{}') } catch (_) {}

    const freshLogo = (sid ? localStorage.getItem(`shop_logo_${sid}`) : null)
      || saved.logo_url || form.logo_url || ''

    const shopSettings = {
      ...form,
      name:             saved.name             || form.name,
      phone:            saved.phone            || form.phone,
      address:          saved.address          || form.address,
      invoice_footer:   saved.invoice_footer   || form.invoice_footer,
      quotation_footer: saved.quotation_footer || form.quotation_footer,
      print_size:       saved.print_size       || form.print_size       || 'thermal',
      print_mode:       saved.print_mode       || form.print_mode       || 'manual',
      print_template:   (sid ? localStorage.getItem(`print_template_${sid}`) : null) || saved.print_template || localStorage.getItem('print_template') || '2',
      logo_url:         freshLogo,
      shop_id:          sid,
    }
    return buildBillHTML(r, isQuotation, shopSettings)
  }

  const printReceipt = () => {
    printHTML(buildReceiptHTML(lastReceipt, false))
  }

  const printQuotation = () => {
    const customer = customers.find(c => String(c.id) === String(customerId))
    const sub = cart.reduce((s, i) => s + i.custom_price * i.qty, 0)
    const disc = parseFloat(discount) || 0
    const tot = Math.max(0, sub - disc)
    const fakeSale = { id: Date.now(), created_at: new Date().toISOString(), created_by: user?.username || 'Staff', payment_type: paymentType, payment_details: null, paid_amount: tot }
    printHTML(buildReceiptHTML({ sale: fakeSale, items: cart, customer, subtotal: sub, totalDiscount: disc, total: tot, paymentType }, true))
  }

  const waQuotation = async (e) => {
    const btn = e?.currentTarget
    if (btn) { btn.disabled = true; btn.textContent = '⏳...' }
    try {
      const customer = customers.find(c => String(c.id) === String(customerId))
      const sub = cart.reduce((s, i) => s + i.custom_price * i.qty, 0)
      const disc = parseFloat(discount) || 0
      const tot = Math.max(0, sub - disc)
      const fakeSale = { id: Date.now(), created_at: new Date().toISOString(), created_by: user?.username || 'Staff', payment_type: paymentType, payment_details: null, paid_amount: tot }
      const html = buildReceiptHTML({ sale: fakeSale, items: cart, customer, subtotal: sub, totalDiscount: disc, total: tot, paymentType }, true)
      const pdfBlob = await generateBillPDF(html)

      let formattedPhone = ''
      if (customer?.phone) {
        const ph = customer.phone.replace(/[^0-9]/g, '')
        formattedPhone = ph.startsWith('03') ? '92' + ph.substring(1) : ph.length === 10 ? '92' + ph : ph
      }

      const msg = `${form.name || 'Shop'} — Quotation\nTotal: Rs. ${tot.toFixed(0)}\n${customer ? 'Customer: ' + customer.name : walkInName ? 'Customer: ' + walkInName : ''}`
      await shareOrDownloadPDF(pdfBlob, `quotation-${String(fakeSale.id).slice(-8)}.pdf`, formattedPhone || null, msg)
    } catch (err) {
      console.error('Quotation PDF failed:', err)
      alert('PDF nahi ban saka.')
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '💬' }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden md:flex-row">

      {/* LEFT: Products */}
      <div className="flex-1 flex flex-col gap-3 min-w-0 min-h-0">

        {/* Sale / Quotation toggle */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
          <button onClick={() => setBarcodeMode(b => !b)}
            className={`flex-1 py-2 rounded-lg font-semibold text-sm transition border ${barcodeMode ? 'bg-green-500 text-white border-green-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-green-50 hover:border-green-300'}`}>
            📷 {barcodeMode ? 'Scanning...' : 'Barcode Scan'}
          </button>
        </div>

        {/* Barcode Scanner Input */}
        {barcodeMode && (
          <form onSubmit={handleBarcodeSubmit} className="flex gap-2 items-center bg-green-50 border-2 border-green-400 rounded-xl px-3 py-2">
            <span className="text-green-600 text-lg">📷</span>
            <input
              ref={barcodeRef}
              type="text"
              value={barcodeInput}
              onChange={e => setBarcodeInput(e.target.value)}
              placeholder="Scan barcode or type SKU → Enter"
              className="flex-1 bg-transparent outline-none text-sm font-mono text-green-800 placeholder-green-400"
              autoComplete="off"
            />
            <button type="submit" className="text-xs bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded-lg font-bold">Add</button>
            <button type="button" onClick={() => { setBarcodeMode(false); setBarcodeInput('') }} className="text-xs text-green-600 hover:text-red-500 font-bold px-2">✕ Exit</button>
          </form>
        )}

        {/* Search + Filters */}
        <div className="flex gap-2 flex-wrap">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="🔍 Search products / brand (F2)..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0 shadow-sm"
          />
          <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none shadow-sm">
            <option value="">All Categories</option>
            {posCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={selectedBrand} onChange={e => setSelectedBrand(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none shadow-sm">
            <option value="">All Brands</option>
            {displayBrands.map(bName => <option key={bName} value={bName}>{bName}</option>)}
          </select>
          {selectedBrand && (
            <button onClick={() => setShowBrandDiscount(true)}
              className="px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm transition whitespace-nowrap shadow-sm">
              % Brand Discount
            </button>
          )}
        </div>

        {/* Product Grid - High-Visibility Responsive Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 overflow-y-auto flex-1 min-h-0 content-start pb-24 md:pb-0 custom-scrollbar">
          {filtered.length === 0 && <p className="text-gray-400 col-span-full text-center py-10">No products found</p>}
          {filtered.map(p => {
            const isOutOfStock = Number(p.stock_quantity) <= 0
            const isLowStock = !isOutOfStock && Number(p.stock_quantity) <= (p.low_stock_threshold || 5)
            return (
              <div
                key={p.id}
                onClick={() => { addToCart(p, parseFloat(cardQtys[p.id]) || 1); setCardQtys(prev => ({ ...prev, [p.id]: '' })) }}
                className={`pos-product-card group bg-white rounded-xl shadow-xs hover:shadow-md p-3 text-left transition-all border cursor-pointer flex flex-col justify-between select-none relative ${
                  isOutOfStock
                    ? 'border-red-200 bg-red-50/20 opacity-80'
                    : isLowStock
                      ? 'border-amber-200 bg-amber-50/15 hover:border-amber-400'
                      : 'border-gray-200/80 hover:border-blue-500 hover:bg-blue-50/30'
                }`}
              >
                {/* Row 1: Dedicated Product Name (100% visible, multi-line wrapping allowed) */}
                <div className="w-full mb-1">
                  <h3 className="font-bold text-gray-900 text-xs sm:text-sm leading-snug break-words w-full" title={p.name}>
                    {p.name}
                  </h3>
                </div>

                {/* Row 2: Separate Price Line & Category / Stock Status Badge */}
                <div className="flex items-center justify-between gap-1 mb-1.5 pt-1 border-t border-gray-100/70">
                  <span className="font-black text-sm sm:text-base text-blue-600 tracking-tight">
                    Rs. {Number(p.sale_price).toLocaleString()}
                  </span>

                  <div className="flex items-center gap-1 shrink-0">
                    {p.brand && (
                      <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200/60 truncate max-w-[90px]">
                        {p.brand}
                      </span>
                    )}
                    {isOutOfStock ? (
                      <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                        Out
                      </span>
                    ) : isLowStock ? (
                      <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                        Low
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Row 3: Stock, Cost & Quick Qty Action */}
                <div className="flex items-center justify-between pt-1 border-t border-gray-100 mt-0.5">
                  <div className="text-[11px] flex items-center gap-1 text-gray-500">
                    <span className={isOutOfStock ? 'text-red-600 font-bold' : isLowStock ? 'text-amber-600 font-semibold' : 'text-gray-500'}>
                      Stock: <span className="font-semibold">{p.stock_quantity}</span>
                    </span>
                    {(user.role === 'admin' || user.role === 'manager') && p.cost_price != null && (
                      <span className="text-gray-400 text-[10px] hidden sm:inline">
                        · Cost: {p.cost_price}
                      </span>
                    )}
                  </div>

                  <div onClick={e => e.stopPropagation()} className="flex items-center gap-1 shrink-0">
                    <input
                      type="number"
                      step="any"
                      min="0.001"
                      max={p.stock_quantity > 0 ? p.stock_quantity : undefined}
                      value={cardQtys[p.id] || ''}
                      onChange={e => setCardQtys(prev => ({ ...prev, [p.id]: e.target.value }))}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.stopPropagation();
                          addToCart(p, parseFloat(cardQtys[p.id]) || 1);
                          setCardQtys(prev => ({ ...prev, [p.id]: '' }))
                        }
                      }}
                      placeholder="Qty"
                      title="Custom quantity"
                      className="w-12 text-[11px] font-medium text-center border border-gray-200 rounded px-1 py-0.5 outline-none focus:border-blue-500 bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        addToCart(p, parseFloat(cardQtys[p.id]) || 1);
                        setCardQtys(prev => ({ ...prev, [p.id]: '' }))
                      }}
                      title="Add to cart"
                      className="px-2 py-0.5 bg-blue-50 hover:bg-blue-600 text-blue-600 hover:text-white rounded text-xs font-black transition border border-blue-200 hover:border-transparent active:scale-95"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
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
      <div className={`${showMobileCart ? 'fixed inset-x-2 top-2 bottom-2 z-50 flex max-h-[calc(100dvh-1rem)]' : 'hidden md:flex'} md:static md:w-96 lg:w-[410px] xl:w-[430px] flex-col gap-2 bg-white rounded-2xl shadow-xl border border-gray-100 p-3.5 h-full min-h-0 overflow-hidden shrink-0`}>

        {/* Mobile close button */}
        <button onClick={() => setShowMobileCart(false)} className="md:hidden self-end text-gray-400 hover:text-gray-700 text-xl font-bold -mt-1 -mr-1 p-1">✕</button>

        {/* Cart Header */}
        <div className="border-b border-gray-100 pb-2 shrink-0 flex justify-between items-center gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-black text-gray-900 tracking-tight flex items-center gap-1.5">
              <span>🛒 Cart</span>
              <span className="bg-blue-100 text-blue-700 text-[10px] font-black px-1.5 py-0.5 rounded-full">{cart.length}</span>
            </h2>
            {saleType === 'quotation' && <span className="text-purple-600 font-bold text-[10px] uppercase bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200">Quotation</span>}
          </div>
          <div className="flex items-center gap-1.5">
            {heldCarts.length > 0 && (
              <button
                onClick={() => setShowHeldCarts(true)}
                className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200/80 rounded-lg text-[10px] font-bold uppercase transition flex items-center gap-1"
              >
                <span>⏸️</span> Held ({heldCarts.length})
              </button>
            )}
            <button
              onClick={() => setShowQuickView(true)}
              className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200/80 rounded-lg text-[10px] font-black uppercase transition flex items-center gap-1"
            >
              <span>🔍</span> Quick View
            </button>
          </div>
        </div>

        {/* Compact Single-Row Customer Selector */}
        <div className="flex items-center gap-1.5 shrink-0 bg-slate-50 p-1.5 rounded-xl border border-slate-200/60">
          <select
            value={customerId}
            onChange={e => setCustomerId(e.target.value)}
            className="flex-1 min-w-0 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-xs truncate"
          >
            <option value="">👤 Walk-in Customer</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} {c.outstanding_balance > 0 ? `(Rs.${c.outstanding_balance} credit)` : ''}
              </option>
            ))}
          </select>

          {!customerId && (
            <>
              <input
                type="text"
                placeholder="Walk-in Name"
                value={walkInName}
                onChange={e => setWalkInName(e.target.value)}
                className="w-28 sm:w-32 px-2 py-1.5 border border-blue-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white placeholder:text-gray-400"
              />
              {walkInName.trim() && (
                <button
                  onClick={() => { setSaveCustomerForm({ name: walkInName, mobile: '' }); setShowSaveCustomer(true) }}
                  title="Save customer permanently"
                  className="px-2 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition shrink-0 shadow-xs"
                >
                  + Save
                </button>
              )}
            </>
          )}
        </div>

        {/* Cart Items — Expanded High-Density Scrollable View */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-1.5 pr-0.5 custom-scrollbar">
          {cart.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full py-12 text-center text-gray-400">
              <span className="text-3xl mb-1 opacity-50">🛍️</span>
              <p className="text-xs font-semibold">Cart is empty</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Click products on left panel to add</p>
            </div>
          )}
          {cart.map(item => {
            const itemProfit = (item.custom_price - (item.cost_price || 0)) * item.qty
            const isAdminOrManager = (user.role === 'admin' || user.role === 'manager' || user.role === 'accountant')
            return (
              <div key={item.id} className="group bg-slate-50 hover:bg-blue-50/40 border border-slate-200/70 hover:border-blue-200 rounded-xl p-2 transition duration-150 shadow-2xs">
                {/* Row 1: Title, Qty stepper & Remove */}
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex-1 min-w-0 pr-1">
                    <p className="text-xs font-bold text-gray-800 truncate leading-tight">{item.name}</p>
                    {item.brand && <p className="text-[10px] text-gray-400 font-medium truncate">{item.brand}</p>}
                  </div>

                  {/* Quantity controls */}
                  <div className="flex items-center bg-white border border-gray-200 rounded-lg p-0.5 shadow-2xs shrink-0">
                    <button
                      onClick={() => updateQty(item.id, Math.max(1, (parseFloat(item.qty) || 1) - 1))}
                      className="w-5 h-5 flex items-center justify-center text-xs font-bold text-gray-500 hover:bg-gray-100 rounded text-center select-none"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      step="any"
                      min="0.001"
                      value={item.qty}
                      onChange={e => updateQty(item.id, e.target.value)}
                      className="w-11 text-center text-xs font-bold text-gray-800 border-none outline-none p-0 focus:ring-0 bg-transparent"
                    />
                    <button
                      onClick={() => updateQty(item.id, (parseFloat(item.qty) || 0) + 1)}
                      className="w-5 h-5 flex items-center justify-center text-xs font-bold text-gray-500 hover:bg-gray-100 rounded text-center select-none"
                    >
                      +
                    </button>
                  </div>

                  <button
                    onClick={() => removeFromCart(item.id)}
                    className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition shrink-0 text-sm font-bold"
                    title="Remove item"
                  >
                    ×
                  </button>
                </div>

                {/* Row 2: Price edit, line total & profit badge */}
                <div className="flex items-center justify-between gap-2 mt-1.5 pt-1 border-t border-slate-200/50 text-xs">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold text-gray-400 uppercase">Unit:</span>
                    <div className="flex items-center bg-white border border-blue-200 rounded-md px-1.5 py-0.5 shadow-2xs">
                      <span className="text-[10px] font-bold text-gray-400 mr-0.5">Rs.</span>
                      <input
                        type="number"
                        value={item.custom_price}
                        onChange={e => updatePrice(item.id, e.target.value)}
                        className="w-16 text-xs font-bold text-blue-700 outline-none p-0 bg-transparent"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isAdminOrManager && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${itemProfit < 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {itemProfit < 0 ? '⚠️ -Rs.' : '+Rs.'}{Math.abs(itemProfit).toFixed(0)}
                      </span>
                    )}
                    <span className="font-black text-xs text-gray-900">
                      Rs. {(item.custom_price * item.qty).toFixed(0)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Bottom Checkout & Payment Section */}
        <div className="shrink-0 space-y-2 border-t border-gray-100 pt-2 bg-white">

          {/* Subtotal & Discount Summary Card */}
          <div className="bg-slate-50/80 rounded-xl p-2 border border-slate-200/60 space-y-1 text-xs">
            {/* Row 1: Subtotal & Inline Discount */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-slate-600 font-medium">
                <span>Subtotal ({cart.reduce((a, c) => a + (parseFloat(c.qty) || 0), 0)} pcs):</span>
                <span className="font-bold text-gray-900">Rs. {subtotal.toFixed(0)}</span>
              </div>

              {hasFeature('discount') && (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-bold text-slate-500">Disc:</span>
                  <div className="flex bg-slate-200/80 rounded p-0.5 text-[9px] font-bold">
                    <button
                      type="button"
                      onClick={() => setDiscountMode('fixed')}
                      className={`px-1 py-0.2 rounded transition ${discountMode === 'fixed' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-600'}`}
                    >
                      Rs
                    </button>
                    <button
                      type="button"
                      onClick={() => setDiscountMode('percent')}
                      className={`px-1 py-0.2 rounded transition ${discountMode === 'percent' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-600'}`}
                    >
                      %
                    </button>
                  </div>

                  {discountMode === 'percent' ? (
                    <div className="flex items-center gap-0.5">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        max="100"
                        value={discountPercent}
                        onChange={e => handlePercentDiscountChange(e.target.value)}
                        placeholder="0"
                        className="w-12 px-1 py-0.5 border border-blue-300 rounded text-right text-xs font-bold text-blue-700 bg-white outline-none"
                      />
                      <span className="text-[10px] font-bold text-slate-400">%</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-0.5">
                      <span className="text-[10px] text-slate-400">Rs.</span>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={discount}
                        onChange={e => handleFixedDiscountChange(e.target.value)}
                        placeholder="0"
                        className="w-14 px-1 py-0.5 border border-blue-300 rounded text-right text-xs font-bold text-blue-700 bg-white outline-none"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Row 2: Quick % Presets */}
            {hasFeature('discount') && (
              <div className="flex items-center gap-1 pt-0.5 border-t border-slate-200/50">
                <span className="text-[9px] text-slate-400 font-semibold shrink-0">Quick %:</span>
                {[2, 5, 10, 15, 20].map(pct => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => {
                      setDiscountMode('percent')
                      handlePercentDiscountChange(pct.toString())
                    }}
                    className={`px-1.5 py-0.2 rounded text-[9px] font-bold border transition shrink-0 ${
                      discountMode === 'percent' && Number(discountPercent) === pct
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
                {(Number(totalDiscount) > 0 || Number(discountPercent) > 0) && (
                  <button
                    type="button"
                    onClick={() => {
                      setDiscount(0)
                      setDiscountPercent('')
                    }}
                    className="text-[9px] text-red-500 hover:underline ml-1 font-bold shrink-0"
                  >
                    Clear
                  </button>
                )}
                {Number(totalDiscount) > 0 && (
                  <span className="text-[10px] font-bold text-red-600 ml-auto">
                    −Rs. {Number(totalDiscount).toFixed(0)} {discountMode === 'fixed' && subtotal > 0 ? `(${((totalDiscount / subtotal) * 100).toFixed(0)}%)` : ''}
                  </span>
                )}
              </div>
            )}

            {/* Row 3: Net Total & Net Profit */}
            <div className="flex justify-between items-center pt-1 border-t border-slate-200/70">
              <div>
                <span className="text-slate-500 text-[10px] uppercase font-black tracking-wider block">Net Total</span>
                {(user.role === 'admin' || user.role === 'manager' || user.role === 'accountant') && totalProfit !== 0 && (
                  <div className={`text-[10px] font-bold ${totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    Net Profit: Rs. {totalProfit.toFixed(0)}
                  </div>
                )}
              </div>
              <div className="font-black text-xl text-slate-900 tracking-tight leading-none">
                Rs. {total.toFixed(0)}
              </div>
            </div>
          </div>

          {/* Tendered & Payment Section */}
          {saleType === 'sale' && (
            <div className="flex flex-col gap-1 bg-gradient-to-br from-blue-50/80 to-indigo-50/50 p-2 rounded-xl border border-blue-100 shadow-2xs">
              {/* Row 1: Tendered input + Quick Chips on same row */}
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[11px] font-bold text-blue-900">💵 Tendered:</span>
                  <div className="flex items-center bg-white border border-blue-300 rounded-md px-1.5 py-0.5 shadow-2xs">
                    <span className="text-[10px] font-bold text-slate-400 mr-0.5">Rs.</span>
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
                      className="w-20 text-right font-black text-blue-900 text-xs outline-none bg-transparent"
                    />
                  </div>
                </div>

                {/* Quick Tender Suggestions inline */}
                <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar">
                  <button
                    type="button"
                    onClick={() => { setPaymentType('cash'); setReceivedAmount(total.toString()) }}
                    className="px-1.5 py-0.5 text-[9px] font-black rounded bg-emerald-600 hover:bg-emerald-700 text-white transition shrink-0 shadow-2xs"
                  >
                    Exact
                  </button>
                  {(() => {
                    const ceil100 = Math.ceil(total / 100) * 100
                    const ceil500 = Math.ceil(total / 500) * 500
                    const ceil1000 = Math.ceil(total / 1000) * 1000
                    const notes = [
                      ceil100 > total ? ceil100 : null,
                      ceil500 > total && ceil500 !== ceil100 ? ceil500 : null,
                      ceil1000 > total && ceil1000 !== ceil500 ? ceil1000 : null,
                      500 > total ? 500 : null,
                      1000 > total ? 1000 : null,
                      5000 > total ? 5000 : null
                    ].filter((v, i, arr) => v !== null && arr.indexOf(v) === i).sort((a,b) => a - b).slice(0, 3)

                    return notes.map(note => (
                      <button
                        key={note}
                        type="button"
                        onClick={() => { setPaymentType('cash'); setReceivedAmount(note.toString()) }}
                        className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-white border border-blue-200 hover:bg-blue-100 text-blue-700 transition shrink-0 shadow-2xs"
                      >
                        Rs.{note}
                      </button>
                    ))
                  })()}
                </div>
              </div>

              {/* Row 2: Live Change Due or Balance Indicator */}
              {receivedAmount !== '' && Number(receivedAmount) > total && (
                <div className="flex items-center justify-between bg-emerald-600 text-white px-2 py-0.5 rounded-lg text-xs font-bold shadow-2xs">
                  <span>🟢 Change Due:</span>
                  <span className="text-sm font-black">Rs. {(Number(receivedAmount) - total).toFixed(0)}</span>
                </div>
              )}
              {receivedAmount !== '' && Number(receivedAmount) < total && (
                <div className="flex items-center justify-between bg-amber-500 text-white px-2 py-0.5 rounded-lg text-xs font-bold shadow-2xs">
                  <span>🟠 Balance (Credit):</span>
                  <span className="text-sm font-black">Rs. {(total - Number(receivedAmount)).toFixed(0)}</span>
                </div>
              )}

              {/* Row 3: Payment Mode Selector Grid */}
              <div className="grid grid-cols-4 gap-1">
                <button onClick={() => { setPaymentType('cash'); setReceivedAmount(total.toString()) }}
                  className={`py-1 rounded-lg font-bold text-[10px] uppercase transition flex items-center justify-center gap-1 ${paymentType === 'cash' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'}`}>
                  💵 Cash
                </button>
                <button onClick={() => { setPaymentType('online'); setReceivedAmount(total.toString()) }}
                  className={`py-1 rounded-lg font-bold text-[10px] uppercase transition flex items-center justify-center gap-1 ${paymentType === 'online' ? 'bg-blue-600 text-white shadow-xs' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'}`}>
                  📱 Online
                </button>
                <button onClick={() => { setPaymentType('credit'); setReceivedAmount('0') }}
                  className={`py-1 rounded-lg font-bold text-[10px] uppercase transition flex items-center justify-center gap-1 ${paymentType === 'credit' ? 'bg-amber-600 text-white shadow-xs' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'}`}>
                  📒 Credit
                </button>
                <button onClick={() => { setPaymentType('split'); setShowPaymentModal(true); if (payments.length === 0) setPayments([{ method: 'cash', amount: total }]) }}
                  className={`py-1 rounded-lg font-bold text-[10px] uppercase transition flex items-center justify-center gap-1 ${paymentType === 'split' ? 'bg-purple-600 text-white shadow-xs' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'}`}>
                  🔀 Split
                </button>
              </div>

              {/* Online payment provider selector + Transaction ID */}
              {paymentType === 'online' && (
                <div className="p-1.5 bg-white border border-blue-200 rounded-lg space-y-1 shadow-2xs">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-blue-900 shrink-0">Provider:</span>
                    <select
                      value={onlineProvider}
                      onChange={e => setOnlineProvider(e.target.value)}
                      className="w-full text-xs font-semibold px-2 py-0.5 bg-slate-50 border border-blue-300 rounded-md focus:ring-1 focus:ring-blue-500 outline-none text-slate-800"
                    >
                      <optgroup label="Mobile Wallets & FinTech">
                        <option value="jazzcash">📱 JazzCash</option>
                        <option value="easypaisa">🟢 Easypaisa</option>
                        <option value="sadapay">💳 SadaPay</option>
                        <option value="nayapay">🟣 NayaPay</option>
                      </optgroup>
                      <optgroup label="Pakistani Banks (IBFT / Raast)">
                        <option value="meezan">🏦 Meezan Bank</option>
                        <option value="hbl">🏦 HBL (Habib Bank)</option>
                        <option value="ubl">🏦 UBL (United Bank)</option>
                        <option value="mcb">🏦 MCB Bank</option>
                        <option value="abl">🏦 Allied Bank (ABL)</option>
                        <option value="alfalah">🏦 Bank Alfalah</option>
                        <option value="faysal">🏦 Faysal Bank</option>
                        <option value="bop">🏦 Bank of Punjab (BOP)</option>
                        <option value="askari">🏦 Askari Bank</option>
                        <option value="other_bank">🏛️ Other Bank Transfer / Raast</option>
                      </optgroup>
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-blue-800 shrink-0">TID / Ref:</span>
                    <input
                      type="text"
                      value={transactionRef}
                      onChange={e => setTransactionRef(e.target.value)}
                      placeholder="e.g. TID-98214 (optional)"
                      className="w-full text-xs px-2 py-0.5 bg-slate-50 border border-blue-200 rounded-md outline-none focus:border-blue-400 placeholder:text-gray-400 font-mono"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons Row */}
          <div className="flex gap-1.5 pt-1">
            <button
              onClick={handleHoldBill}
              disabled={cart.length === 0}
              title="Hold this cart"
              className="px-3 py-2 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-xl text-xs font-bold transition disabled:opacity-40 shrink-0"
            >
              ⏸️
            </button>
            <button
              onClick={clearCart}
              disabled={cart.length === 0}
              title="Clear cart"
              className="px-3 py-2 bg-slate-100 hover:bg-red-100 hover:text-red-700 text-slate-600 rounded-xl text-xs font-bold transition disabled:opacity-40 shrink-0"
            >
              🗑️
            </button>
            <button
              onClick={handleCompleteSale}
              disabled={saving || cart.length === 0}
              className={`flex-1 py-2.5 text-white text-sm font-black rounded-xl transition duration-150 shadow-md active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2 ${
                saleType === 'quotation'
                  ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-200'
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-blue-200'
              }`}
            >
              {saving ? 'Processing...' : saleType === 'quotation' ? '🖨️ Print Quote' : '✅ Complete Sale'}
            </button>
            {saleType === 'quotation' && cart.length > 0 && (
              <button
                onClick={waQuotation}
                title="Send quotation via WhatsApp"
                className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition shrink-0 shadow-xs"
              >
                💬
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Save Walk-in as Customer Modal */}
      {showSaveCustomer && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-start sm:items-center justify-center z-50 overflow-y-auto py-4 px-2 sm:px-4">
          <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-6 w-full max-w-sm">
            <h3 className="font-bold text-gray-800 text-lg mb-1">👤 Customer Save Karein</h3>
            <p className="text-sm text-gray-500 mb-4">Yeh walk-in customer ko apni customer list mein add karein</p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Naam *</label>
                <input
                  type="text"
                  value={saveCustomerForm.name}
                  onChange={e => setSaveCustomerForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Customer ka naam"
                  autoFocus
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mobile Number</label>
                <input
                  type="tel"
                  value={saveCustomerForm.mobile}
                  onChange={e => setSaveCustomerForm(f => ({ ...f, mobile: e.target.value }))}
                  placeholder="0300-0000000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={handleSaveCustomer}
                disabled={savingCustomer}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold transition disabled:opacity-50"
              >
                {savingCustomer ? 'Saving...' : '✅ Save Customer'}
              </button>
              <button
                onClick={() => { setShowSaveCustomer(false); setSaveCustomerForm({ name: '', mobile: '' }) }}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-bold transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Brand Discount Modal */}
      {showBrandDiscount && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-start sm:items-center justify-center z-50 overflow-y-auto py-4 px-2 sm:px-4">
          <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-6 w-full max-w-sm">
            <h3 className="font-bold text-gray-800 mb-2">🏷️ {selectedBrand} — Brand Discount</h3>

            {/* Mode Toggle */}
            <div className="flex gap-2 mb-3">
              <button onClick={() => setBrandDiscountMode('cart_only')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${brandDiscountMode === 'cart_only' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                🛒 Cart Only
              </button>
              <button onClick={() => setBrandDiscountMode('add_all')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${brandDiscountMode === 'add_all' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
                📦 Add All Products
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              {brandDiscountMode === 'cart_only'
                ? 'Sirf cart mein mojood is brand ke products ki price update hogi.'
                : 'Is brand ke tamam products cart mein add honge discount ke saath.'}
            </p>

            {/* Discount Type */}
            <div className="flex gap-2 mb-3">
              <button onClick={() => setBrandDiscountType('percent')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${brandDiscountType === 'percent' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                % Percent ({pricingConfig.label})
              </button>
              <button onClick={() => setBrandDiscountType('fixed')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${brandDiscountType === 'fixed' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                Rs. Fixed
              </button>
            </div>
            <input type="number" value={brandDiscountValue} onChange={e => setBrandDiscountValue(e.target.value)}
              placeholder={brandDiscountType === 'percent' ? `e.g. 1 (extra % from ${pricingConfig.label})` : 'e.g. 50 (Rs.)'}
              className="w-full px-4 py-2 border rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />

            {/* Preview */}
            {brandDiscountType === 'percent' && brandDiscountValue && (() => {
              const val = parseFloat(brandDiscountValue) || 0
              const cartBrandItems = cart.filter(i => i.brand === selectedBrand)
              const previewItems = brandDiscountMode === 'cart_only'
                ? cartBrandItems
                : products.filter(p => p.brand === selectedBrand).map(p => {
                    const inCart = cartBrandItems.find(c => c.id === p.id)
                    return inCart || p
                  })
              if (previewItems.length === 0) return <p className="text-xs text-gray-400 mb-3 italic">No matching items in cart.</p>
              return (
                <div className="bg-gray-50 rounded-lg p-2 mb-3 max-h-32 overflow-y-auto">
                  <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Preview</p>
                  {previewItems.slice(0, 5).map(item => {
                    const cRate = parseFloat(item.c_rate) || 0
                    const currentPrice = item.custom_price || item.sale_price
                    let newPrice = currentPrice
                    if (cRate > 0) {
                      const currentDisc = (1 - currentPrice / cRate) * 100
                      newPrice = cRate * (1 - (currentDisc + val) / 100)
                    } else {
                      newPrice = currentPrice - (currentPrice * val / 100)
                    }
                    newPrice = Math.max(0, newPrice)
                    return (
                      <div key={item.id} className="flex justify-between text-xs text-gray-600">
                        <span className="truncate flex-1">{item.name}</span>
                        <span className="text-gray-400 line-through mx-1">{Math.round(currentPrice)}</span>
                        <span className="text-green-600 font-bold">{Math.round(newPrice)}</span>
                      </div>
                    )
                  })}
                  {previewItems.length > 5 && <p className="text-[10px] text-gray-400">+{previewItems.length - 5} more...</p>}
                </div>
              )
            })()}

            <div className="flex gap-3">
              <button onClick={applyBrandDiscount} className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition">
                {brandDiscountMode === 'cart_only' ? '✅ Apply to Cart' : 'Apply & Add All'}
              </button>
              <button onClick={() => setShowBrandDiscount(false)} className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt Modal */}
      {lastReceipt && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-start sm:items-center justify-center z-50 overflow-y-auto py-4 px-2 sm:px-4">
          <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-6 w-full max-w-sm">
            <div className="text-center mb-4">
              <div className="text-4xl mb-1">✅</div>
              <h2 className="text-xl font-bold text-gray-800">Sale Complete!</h2>
              <p className="text-gray-500 text-sm">{lastReceipt.paymentType === 'credit' ? '📒 Credit sale' : '💵 Cash sale'}</p>
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
                    onClick={async (e) => {
                      const btn = e.currentTarget
                      btn.disabled = true
                      btn.textContent = '⏳ Generating PDF...'
                      try {
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

                        const billHtml = buildReceiptHTML(lastReceipt, false)
                        const pdfBlob = await generateBillPDF(billHtml)
                        const invoiceId = String(lastReceipt.sale.id).slice(-8)
                        await shareOrDownloadPDF(pdfBlob, `bill-${invoiceId}.pdf`, formattedPhone, msg)
                      } catch (err) {
                        console.error('PDF share failed:', err)
                        alert('PDF nahi ban saka. WhatsApp text message bheja ja raha hai.')
                        const phone = lastReceipt.customer.phone.replace(/[^0-9]/g, '')
                        let formattedPhone = phone
                        if (phone.startsWith('03')) formattedPhone = '92' + phone.substring(1)
                        else if (phone.length === 10) formattedPhone = '92' + phone
                        const msg = `${form.name || 'Shop'} - Bill Rs. ${lastReceipt.total.toFixed(0)}`
                        window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`, '_blank')
                      } finally {
                        btn.disabled = false
                        btn.innerHTML = '<span>💬</span> WhatsApp'
                      }
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
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-start sm:items-center justify-center z-50 overflow-y-auto py-4 px-2 sm:px-4">
          <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-6 w-full max-w-sm">
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
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-start sm:items-center justify-center z-50 overflow-y-auto py-4 px-2 sm:px-4">
          <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-6 w-full max-w-md">
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
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-start sm:items-center justify-center z-50 overflow-y-auto py-4 px-2 sm:px-4">
          <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-6 w-full max-w-sm">
            <h2 className="text-xl font-bold text-gray-800 mb-4">🔀 Split Payment</h2>
            <div className="space-y-3 mb-4 max-h-[340px] overflow-y-auto">
              {payments.map((p, idx) => (
                <div key={idx} className="flex flex-col gap-1.5 bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                  <div className="flex gap-2 items-center">
                    <select
                      value={p.method}
                      onChange={(e) => {
                        const newP = [...payments]; newP[idx].method = e.target.value; setPayments(newP)
                      }}
                      className="flex-1 bg-white border border-gray-300 rounded px-2 py-1.5 text-xs font-semibold outline-none focus:border-blue-500"
                    >
                      <option value="cash">💵 Cash</option>
                      <optgroup label="Mobile Wallets & FinTech">
                        <option value="jazzcash">📱 JazzCash</option>
                        <option value="easypaisa">🟢 Easypaisa</option>
                        <option value="sadapay">💳 SadaPay</option>
                        <option value="nayapay">🟣 NayaPay</option>
                      </optgroup>
                      <optgroup label="Pakistani Banks">
                        <option value="meezan">🏦 Meezan Bank</option>
                        <option value="hbl">🏦 HBL (Habib Bank)</option>
                        <option value="ubl">🏦 UBL (United Bank)</option>
                        <option value="mcb">🏦 MCB Bank</option>
                        <option value="abl">🏦 Allied Bank (ABL)</option>
                        <option value="bank">🏛️ Bank Transfer / Raast</option>
                        <option value="card">💳 Card</option>
                      </optgroup>
                    </select>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={p.amount}
                      onChange={(e) => {
                        const newP = [...payments]; newP[idx].amount = e.target.value; setPayments(newP)
                      }}
                      className="w-24 border border-gray-300 rounded px-2 py-1.5 text-xs font-bold text-right"
                      placeholder="Amount"
                    />
                    <button onClick={() => setPayments(payments.filter((_, i) => i !== idx))} className="text-red-500 font-bold px-1 text-sm hover:bg-red-50 rounded">✕</button>
                  </div>
                  <input
                    type="text"
                    value={p.ref || ''}
                    onChange={(e) => {
                      const newP = [...payments]; newP[idx].ref = e.target.value; setPayments(newP)
                    }}
                    className="w-full text-[11px] border border-gray-200 rounded px-2 py-1 bg-white outline-none focus:border-blue-400 placeholder:text-gray-400"
                    placeholder="TID / Ref # / Account (optional)"
                  />
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
                  setPayments([...payments, { method: 'jazzcash', amount: Math.max(0, remaining), ref: '' }])
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
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-start sm:items-center justify-center z-50 overflow-y-auto py-4 px-2 sm:px-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-4xl flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-4 shrink-0">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <span>🔍 Cart Quick View</span>
                <span className="text-sm font-normal text-gray-500">({cart.length} items)</span>
              </h2>
              <button onClick={() => setShowQuickView(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>

            <div className="flex-1 overflow-y-auto mb-4 border rounded-xl">
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
                          <button onClick={() => updateQty(item.id, Math.max(0.01, item.qty - 1))} className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200 font-bold">-</button>
                          <input type="number" step="any" min="0.001" value={item.qty} onChange={e => updateQty(item.id, e.target.value)}
                            className="w-20 px-2 py-1 border rounded text-center focus:ring-1 focus:ring-blue-500 outline-none" />
                          <button onClick={() => updateQty(item.id, item.qty + 1)} className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200 font-bold">+</button>
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
