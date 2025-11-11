import React, { useState, useMemo } from 'react';
import { Calculator, TrendingUp, AlertCircle, CheckCircle2, AlertTriangle, DollarSign } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';

const InvestmentCalculator = () => {
  const [inputs, setInputs] = useState({
    purchasePrice: 250000,
    downPaymentPercent: 20,
    interestRate: 9.5,
    loanTerm: 12,
    closingCosts: 3,
    rehabBudget: 50000,
    arv: 350000,
    holdingMonths: 6,
    sellingCosts: 6,
  });

  const [rehabDetails, setRehabDetails] = useState({
    roof: 0,
    foundation: 0,
    hvac: 0,
    plumbing: 0,
    electrical: 0,
    kitchen: 15000,
    bathrooms: 10000,
    flooring: 8000,
    paint: 5000,
    landscaping: 3000,
    permits: 2000,
    other: 7000,
  });

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value) => {
    return `${value.toFixed(2)}%`;
  };

  // Calculate totals
  const calculations = useMemo(() => {
    const downPayment = inputs.purchasePrice * (inputs.downPaymentPercent / 100);
    const loanAmount = inputs.purchasePrice - downPayment;
    const closingCostsAmount = inputs.purchasePrice * (inputs.closingCosts / 100);
    
    // Total rehab from detailed items
    const totalRehabDetailed = Object.values(rehabDetails).reduce((sum, val) => sum + val, 0);
    const rehabCost = totalRehabDetailed > 0 ? totalRehabDetailed : inputs.rehabBudget;
    
    // Monthly loan payment (interest only for hard money)
    const monthlyInterest = (loanAmount * (inputs.interestRate / 100)) / 12;
    const monthlyLoanPayment = monthlyInterest;
    
    // Holding costs
    const monthlyPropertyTax = (inputs.purchasePrice * 0.012) / 12; // Estimate 1.2% annual
    const monthlyInsurance = 150; // Estimate
    const monthlyUtilities = 200; // Estimate
    const totalMonthlyHolding = monthlyLoanPayment + monthlyPropertyTax + monthlyInsurance + monthlyUtilities;
    const totalHoldingCosts = totalMonthlyHolding * inputs.holdingMonths;
    
    // Selling costs
    const sellingCostsAmount = inputs.arv * (inputs.sellingCosts / 100);
    
    // Total investment
    const totalInvestment = downPayment + closingCostsAmount + rehabCost + totalHoldingCosts + sellingCostsAmount;
    
    // Net profit
    const netProfit = inputs.arv - totalInvestment - loanAmount;
    
    // ROI
    const cashInvested = downPayment + closingCostsAmount + rehabCost + totalHoldingCosts;
    const roi = (netProfit / cashInvested) * 100;
    
    // 70% Rule
    const maxOffer70Rule = (inputs.arv * 0.70) - rehabCost;
    const meets70Rule = inputs.purchasePrice <= maxOffer70Rule;
    
    // Deal quality
    let dealQuality = 'poor';
    let dealColor = 'red';
    let dealIcon = AlertCircle;
    
    if (roi >= 20 && meets70Rule) {
      dealQuality = 'excellent';
      dealColor = 'green';
      dealIcon = CheckCircle2;
    } else if (roi >= 15 || meets70Rule) {
      dealQuality = 'good';
      dealColor = 'amber';
      dealIcon = AlertTriangle;
    } else if (roi >= 10) {
      dealQuality = 'marginal';
      dealColor = 'yellow';
      dealIcon = AlertTriangle;
    }
    
    return {
      downPayment,
      loanAmount,
      closingCostsAmount,
      rehabCost,
      monthlyLoanPayment,
      totalHoldingCosts,
      sellingCostsAmount,
      totalInvestment,
      netProfit,
      cashInvested,
      roi,
      maxOffer70Rule,
      meets70Rule,
      dealQuality,
      dealColor,
      dealIcon,
    };
  }, [inputs, rehabDetails]);

  const updateInput = (key, value) => {
    setInputs({ ...inputs, [key]: parseFloat(value) || 0 });
  };

  const updateRehabDetail = (key, value) => {
    setRehabDetails({ ...rehabDetails, [key]: parseFloat(value) || 0 });
  };

  return (
    <div className="min-h-screen bg-gray-50 pt-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center space-x-4 mb-4">
            <div className="bg-[#002349] p-4 rounded-xl shadow-lg">
              <Calculator className="h-10 w-10 text-[#BD9042]" />
            </div>
            <div>
              <h1 className="text-5xl font-bold text-[#002349] tracking-tight">Fix & Flip Investment Calculator</h1>
              <p className="text-gray-600 mt-2 text-lg">Analyze your real estate investment deals with precision</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Input Section */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="border border-gray-200 shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center text-2xl text-[#002349]">
                  <DollarSign className="h-6 w-6 mr-2 text-[#BD9042]" />
                  Purchase & Financing
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="purchasePrice">Purchase Price</Label>
                    <Input
                      id="purchasePrice"
                      type="number"
                      value={inputs.purchasePrice}
                      onChange={(e) => updateInput('purchasePrice', e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="downPayment">Down Payment (%)</Label>
                    <Input
                      id="downPayment"
                      type="number"
                      value={inputs.downPaymentPercent}
                      onChange={(e) => updateInput('downPaymentPercent', e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="interestRate">Interest Rate (%)</Label>
                    <Input
                      id="interestRate"
                      type="number"
                      step="0.1"
                      value={inputs.interestRate}
                      onChange={(e) => updateInput('interestRate', e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="loanTerm">Loan Term (months)</Label>
                    <Input
                      id="loanTerm"
                      type="number"
                      value={inputs.loanTerm}
                      onChange={(e) => updateInput('loanTerm', e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="closingCosts">Closing Costs (%)</Label>
                    <Input
                      id="closingCosts"
                      type="number"
                      step="0.1"
                      value={inputs.closingCosts}
                      onChange={(e) => updateInput('closingCosts', e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-lg">
              <CardHeader>
                <CardTitle>Rehabilitation Costs</CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="simple">
                  <TabsList className="grid w-full grid-cols-2 mb-4">
                    <TabsTrigger value="simple">Simple Mode</TabsTrigger>
                    <TabsTrigger value="detailed">Detailed Mode</TabsTrigger>
                  </TabsList>

                  <TabsContent value="simple">
                    <div>
                      <Label htmlFor="rehabBudget">Total Rehab Budget</Label>
                      <Input
                        id="rehabBudget"
                        type="number"
                        value={inputs.rehabBudget}
                        onChange={(e) => updateInput('rehabBudget', e.target.value)}
                        className="mt-1"
                      />
                      <p className="text-sm text-gray-500 mt-2">
                        Quick estimate based on overall renovation scope
                      </p>
                    </div>
                  </TabsContent>

                  <TabsContent value="detailed" className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      {Object.keys(rehabDetails).map((key) => (
                        <div key={key}>
                          <Label htmlFor={key} className="capitalize">
                            {key.replace(/([A-Z])/g, ' $1').trim()}
                          </Label>
                          <Input
                            id={key}
                            type="number"
                            value={rehabDetails[key]}
                            onChange={(e) => updateRehabDetail(key, e.target.value)}
                            className="mt-1"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="pt-4 border-t border-gray-200">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-gray-900">Total Rehab Cost:</span>
                        <span className="text-xl font-bold text-amber-700">
                          {formatCurrency(Object.values(rehabDetails).reduce((sum, val) => sum + val, 0))}
                        </span>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <Card className="border-none shadow-lg">
              <CardHeader>
                <CardTitle>After Repair Value & Holding</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="arv">After Repair Value (ARV)</Label>
                    <Input
                      id="arv"
                      type="number"
                      value={inputs.arv}
                      onChange={(e) => updateInput('arv', e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="holdingMonths">Holding Period (months)</Label>
                    <Input
                      id="holdingMonths"
                      type="number"
                      value={inputs.holdingMonths}
                      onChange={(e) => updateInput('holdingMonths', e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="sellingCosts">Selling Costs (%)</Label>
                    <Input
                      id="sellingCosts"
                      type="number"
                      step="0.1"
                      value={inputs.sellingCosts}
                      onChange={(e) => updateInput('sellingCosts', e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Results Section */}
          <div className="lg:col-span-1 space-y-6">
            {/* Deal Advisor */}
            <Card className={`border-none shadow-lg border-l-4 border-l-${calculations.dealColor}-500`}>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <calculations.dealIcon className={`h-6 w-6 mr-2 text-${calculations.dealColor}-600`} />
                  Deal Advisor
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-4">
                  <div className={`text-4xl font-bold text-${calculations.dealColor}-600 capitalize mb-2`}>
                    {calculations.dealQuality}
                  </div>
                  <p className="text-gray-600 text-sm">
                    {calculations.dealQuality === 'excellent' && 'This looks like a profitable deal!'}
                    {calculations.dealQuality === 'good' && 'This deal has potential with careful execution.'}
                    {calculations.dealQuality === 'marginal' && 'This deal is tight. Review your numbers carefully.'}
                    {calculations.dealQuality === 'poor' && 'High risk. Consider negotiating or passing.'}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Key Metrics */}
            <Card className="border-none shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <TrendingUp className="h-5 w-5 mr-2 text-amber-700" />
                  Key Metrics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center py-3 border-b border-gray-200">
                  <span className="text-gray-700">Net Profit</span>
                  <span className={`text-xl font-bold ${calculations.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(calculations.netProfit)}
                  </span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-gray-200">
                  <span className="text-gray-700">ROI</span>
                  <span className={`text-xl font-bold ${calculations.roi >= 15 ? 'text-green-600' : calculations.roi >= 10 ? 'text-amber-600' : 'text-red-600'}`}>
                    {formatPercent(calculations.roi)}
                  </span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-gray-200">
                  <span className="text-gray-700">Total Investment</span>
                  <span className="text-lg font-semibold text-gray-900">
                    {formatCurrency(calculations.totalInvestment)}
                  </span>
                </div>
                <div className="flex justify-between items-center py-3">
                  <span className="text-gray-700">Cash Invested</span>
                  <span className="text-lg font-semibold text-gray-900">
                    {formatCurrency(calculations.cashInvested)}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* 70% Rule Check */}
            <Card className="border-none shadow-lg">
              <CardHeader>
                <CardTitle>70% Rule Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700">Max Offer (70% Rule)</span>
                    <span className="font-bold text-gray-900">
                      {formatCurrency(calculations.maxOffer70Rule)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700">Your Offer</span>
                    <span className="font-bold text-gray-900">
                      {formatCurrency(inputs.purchasePrice)}
                    </span>
                  </div>
                  <div className={`flex items-center justify-center py-3 px-4 rounded-lg ${calculations.meets70Rule ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {calculations.meets70Rule ? (
                      <>
                        <CheckCircle2 className="h-5 w-5 mr-2" />
                        <span className="font-semibold">Meets 70% Rule</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-5 w-5 mr-2" />
                        <span className="font-semibold">Does Not Meet 70% Rule</span>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Cost Breakdown */}
            <Card className="border-none shadow-lg">
              <CardHeader>
                <CardTitle>Cost Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-gray-700">Down Payment</span>
                  <span className="font-semibold">{formatCurrency(calculations.downPayment)}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-gray-700">Closing Costs</span>
                  <span className="font-semibold">{formatCurrency(calculations.closingCostsAmount)}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-gray-700">Rehab Costs</span>
                  <span className="font-semibold">{formatCurrency(calculations.rehabCost)}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-gray-700">Holding Costs</span>
                  <span className="font-semibold">{formatCurrency(calculations.totalHoldingCosts)}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-gray-700">Selling Costs</span>
                  <span className="font-semibold">{formatCurrency(calculations.sellingCostsAmount)}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-gray-700">Loan Payoff</span>
                  <span className="font-semibold">{formatCurrency(calculations.loanAmount)}</span>
                </div>
              </CardContent>
            </Card>

            <Button className="w-full bg-[#002349] hover:bg-[#003366] text-white py-6 text-lg font-bold tracking-wide shadow-lg">
              SCHEDULE CONSULTATION
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvestmentCalculator;
