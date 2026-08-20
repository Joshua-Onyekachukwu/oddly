export default function FeaturesPage() {
  return (
    <div className="pt-24 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-oddly-navy mb-4">
            Features
          </h1>
          <p className="text-xl text-neutral-600 max-w-2xl mx-auto">
            Everything you need for intelligent betting decisions.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <div className="card">
            <h3 className="text-xl font-bold text-oddly-navy mb-2">
              AI-Powered Predictions
            </h3>
            <p className="text-neutral-600">
              Dixon-Coles statistical model combined with XGBoost ensemble for
              accurate probability estimation.
            </p>
          </div>
          <div className="card">
            <h3 className="text-xl font-bold text-oddly-navy mb-2">
              Value Detection
            </h3>
            <p className="text-neutral-600">
              Automatically compare model probabilities against bookmaker odds
              to identify positive expected value.
            </p>
          </div>
          <div className="card">
            <h3 className="text-xl font-bold text-oddly-navy mb-2">
              Accumulator Builder
            </h3>
            <p className="text-neutral-600">
              Build accumulators with honest probability estimates. No hard
              limit on selections.
            </p>
          </div>
          <div className="card">
            <h3 className="text-xl font-bold text-oddly-navy mb-2">
              AI Analyst Chat
            </h3>
            <p className="text-neutral-600">
              Natural language interface to query data, build accumulators, and
              get explanations.
            </p>
          </div>
          <div className="card">
            <h3 className="text-xl font-bold text-oddly-navy mb-2">
              Transparent Tracking
            </h3>
            <p className="text-neutral-600">
              Every prediction tracked and verified. Public model performance
              you can trust.
            </p>
          </div>
          <div className="card">
            <h3 className="text-xl font-bold text-oddly-navy mb-2">
              Rollover Challenge
            </h3>
            <p className="text-neutral-600">
              Daily curated picks with honest probability math. Elite tier
              exclusive.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
