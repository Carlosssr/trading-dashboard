import { money, ratio, sumBy, ZERO, type Money, type MoneyInput } from './money'

/**
 * Real-estate arithmetic.
 *
 *   Property Equity   = Estimated Value − Mortgage Balance
 *   Monthly Cash Flow = Rental Income − Property Expenses − Debt Service
 */

export type PropertyInput = {
  id: string
  name: string
  estimatedValue: MoneyInput
  purchasePrice?: MoneyInput
  isRental: boolean
  monthlyRent: MoneyInput
  monthlyPropertyTax: MoneyInput
  monthlyInsurance: MoneyInput
  monthlyHoa: MoneyInput
  monthlyOtherExpenses: MoneyInput
  /** From the linked mortgage account when there is one. */
  mortgageBalance: MoneyInput
  mortgagePayment: MoneyInput
  mortgageRate: number | null
}

export type PropertyMetrics = {
  equity: Money
  /** Equity ÷ value. The share of the property actually owned. */
  equityPercent: number
  monthlyExpenses: Money
  debtService: Money
  monthlyCashFlow: Money
  annualCashFlow: Money
  /** Annual net operating income ÷ value. Null for non-rentals. */
  capRate: number | null
  /** Total appreciation since purchase, when a purchase price is known. */
  appreciation: Money | null
  appreciationPercent: number | null
}

export function computePropertyMetrics(property: PropertyInput): PropertyMetrics {
  const value = money(property.estimatedValue)
  const mortgageBalance = money(property.mortgageBalance).abs()
  const equity = value.minus(mortgageBalance)

  // Debt service is the full mortgage payment. Tax and insurance are held
  // separately, so an escrowed payment would double-count if both were summed —
  // the seed and the manual entry form both treat the payment as principal and
  // interest only.
  const debtService = money(property.mortgagePayment)

  const monthlyExpenses = sumBy(
    [
      property.monthlyPropertyTax,
      property.monthlyInsurance,
      property.monthlyHoa,
      property.monthlyOtherExpenses,
    ],
    (v) => v,
  )

  const rent = property.isRental ? money(property.monthlyRent) : ZERO
  const monthlyCashFlow = rent.minus(monthlyExpenses).minus(debtService)

  // Cap rate is unlevered by definition, so debt service is excluded here.
  const netOperatingIncome = rent.minus(monthlyExpenses).times(12)

  const purchasePrice = property.purchasePrice ? money(property.purchasePrice) : null
  const appreciation = purchasePrice ? value.minus(purchasePrice) : null

  return {
    equity,
    equityPercent: ratio(equity, value),
    monthlyExpenses,
    debtService,
    monthlyCashFlow,
    annualCashFlow: monthlyCashFlow.times(12),
    capRate: property.isRental && value.greaterThan(0) ? netOperatingIncome.dividedBy(value).toNumber() : null,
    appreciation,
    appreciationPercent:
      purchasePrice && purchasePrice.greaterThan(0) && appreciation
        ? appreciation.dividedBy(purchasePrice).toNumber()
        : null,
  }
}

export type PortfolioMetrics = {
  propertyCount: number
  rentalCount: number
  totalValue: Money
  totalMortgageBalance: Money
  totalEquity: Money
  monthlyRent: Money
  monthlyExpenses: Money
  monthlyDebtService: Money
  monthlyCashFlow: Money
  annualCashFlow: Money
}

export function computePortfolio(properties: PropertyInput[]): PortfolioMetrics {
  const metrics = properties.map((property) => ({
    property,
    computed: computePropertyMetrics(property),
  }))

  const monthlyCashFlow = metrics.reduce<Money>(
    (total, m) => total.plus(m.computed.monthlyCashFlow),
    ZERO,
  )

  return {
    propertyCount: properties.length,
    rentalCount: properties.filter((p) => p.isRental).length,
    totalValue: sumBy(properties, (p) => p.estimatedValue),
    totalMortgageBalance: sumBy(properties, (p) => money(p.mortgageBalance).abs()),
    totalEquity: metrics.reduce<Money>((total, m) => total.plus(m.computed.equity), ZERO),
    monthlyRent: sumBy(
      properties.filter((p) => p.isRental),
      (p) => p.monthlyRent,
    ),
    monthlyExpenses: metrics.reduce<Money>((total, m) => total.plus(m.computed.monthlyExpenses), ZERO),
    monthlyDebtService: metrics.reduce<Money>((total, m) => total.plus(m.computed.debtService), ZERO),
    monthlyCashFlow,
    annualCashFlow: monthlyCashFlow.times(12),
  }
}
