#!/usr/bin/env python3
"""
Performance Evaluation Script

Measures signup latency from scheduled trigger → confirmation page submitted.
Metrics: Win Rate, Median Completion Time, 95th percentile latency
"""

import asyncio
import json
import logging
import statistics
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from dataclasses import dataclass

@dataclass
class SignupAttempt:
    signup_id: str
    provider: str
    program_id: str
    scheduled_time: datetime
    actual_start_time: Optional[datetime] = None
    completion_time: Optional[datetime] = None
    success: bool = False
    failure_reason: Optional[str] = None
    latency_ms: Optional[float] = None

class PerformanceEvaluator:
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.attempts: List[SignupAttempt] = []
        
    async def simulate_signup_attempt(self, provider: str, program_id: str) -> SignupAttempt:
        """Simulate a signup attempt with realistic timing"""
        signup_id = f"signup_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{provider}"
        scheduled_time = datetime.now()
        
        attempt = SignupAttempt(
            signup_id=signup_id,
            provider=provider,
            program_id=program_id,
            scheduled_time=scheduled_time
        )
        
        # Simulate scheduling precision (should start within 100ms of scheduled time)
        await asyncio.sleep(0.05)  # Simulate scheduler delay
        attempt.actual_start_time = datetime.now()
        
        start_time = attempt.actual_start_time
        
        try:
            # Simulate the full signup flow
            await self._simulate_login(provider)
            await self._simulate_navigation(provider, program_id)
            await self._simulate_form_filling()
            await self._simulate_payment()
            
            attempt.completion_time = datetime.now()
            attempt.success = True
            attempt.latency_ms = (attempt.completion_time - start_time).total_seconds() * 1000
            
        except Exception as e:
            attempt.completion_time = datetime.now()
            attempt.success = False
            attempt.failure_reason = str(e)
            attempt.latency_ms = (attempt.completion_time - start_time).total_seconds() * 1000
        
        return attempt
    
    async def _simulate_login(self, provider: str):
        """Simulate login process"""
        # Different providers have different login complexities
        login_times = {
            'skiclubpro': 0.8,  # 800ms average
            'daysmart': 1.2,    # 1200ms average  
            'campminder': 0.6   # 600ms average
        }
        
        await asyncio.sleep(login_times.get(provider, 1.0))
        
        # Simulate occasional login failures
        if provider == 'skiclubpro' and datetime.now().second % 10 == 0:
            raise Exception("Login failed: Invalid credentials")
    
    async def _simulate_navigation(self, provider: str, program_id: str):
        """Simulate navigating to the program signup page"""
        await asyncio.sleep(0.3)  # Page load time
        
        # Simulate program not found or full
        if program_id == "full_program":
            raise Exception("Program is full")
    
    async def _simulate_form_filling(self):
        """Simulate filling out registration form"""
        await asyncio.sleep(0.5)  # Form filling time
    
    async def _simulate_payment(self):
        """Simulate payment processing"""
        await asyncio.sleep(1.5)  # Payment gateway processing
        
        # Simulate payment failures
        if datetime.now().second % 20 == 0:
            raise Exception("Payment failed: Card declined")
    
    async def run_performance_evaluation(self, num_attempts: int = 50) -> Dict:
        """Run comprehensive performance evaluation"""
        self.logger.info(f"Starting performance evaluation with {num_attempts} attempts")
        
        providers = ['skiclubpro', 'daysmart', 'campminder']
        program_scenarios = [
            'regular_program',
            'popular_program', 
            'full_program'  # This will fail
        ]
        
        # Run concurrent signup attempts
        tasks = []
        for i in range(num_attempts):
            provider = providers[i % len(providers)]
            program = program_scenarios[i % len(program_scenarios)]
            task = self.simulate_signup_attempt(provider, program)
            tasks.append(task)
        
        # Execute all attempts
        self.attempts = await asyncio.gather(*tasks)
        
        return self._calculate_performance_metrics()
    
    def _calculate_performance_metrics(self) -> Dict:
        """Calculate performance metrics from attempts"""
        successful_attempts = [a for a in self.attempts if a.success]
        failed_attempts = [a for a in self.attempts if not a.success]
        
        # Win rate calculation
        total_attempts = len(self.attempts)
        successful_count = len(successful_attempts)
        win_rate = successful_count / total_attempts if total_attempts > 0 else 0
        
        # Latency calculations
        successful_latencies = [a.latency_ms for a in successful_attempts if a.latency_ms]
        all_latencies = [a.latency_ms for a in self.attempts if a.latency_ms]
        
        latency_stats = {}
        if successful_latencies:
            latency_stats = {
                'median_ms': statistics.median(successful_latencies),
                'mean_ms': statistics.mean(successful_latencies),
                'p95_ms': self._percentile(successful_latencies, 95),
                'p99_ms': self._percentile(successful_latencies, 99),
                'min_ms': min(successful_latencies),
                'max_ms': max(successful_latencies)
            }
        
        # Provider-specific metrics
        provider_metrics = {}
        providers = set(a.provider for a in self.attempts)
        for provider in providers:
            provider_attempts = [a for a in self.attempts if a.provider == provider]
            provider_successful = [a for a in provider_attempts if a.success]
            
            provider_metrics[provider] = {
                'attempts': len(provider_attempts),
                'successes': len(provider_successful),
                'win_rate': len(provider_successful) / len(provider_attempts) if provider_attempts else 0,
                'avg_latency_ms': statistics.mean([a.latency_ms for a in provider_successful if a.latency_ms]) if provider_successful else 0
            }
        
        # Failure analysis
        failure_reasons = {}
        for attempt in failed_attempts:
            reason = attempt.failure_reason or "Unknown"
            failure_reasons[reason] = failure_reasons.get(reason, 0) + 1
        
        # Scheduling precision (how close to scheduled time did we start?)
        scheduling_delays = []
        for attempt in self.attempts:
            if attempt.actual_start_time:
                delay_ms = (attempt.actual_start_time - attempt.scheduled_time).total_seconds() * 1000
                scheduling_delays.append(delay_ms)
        
        return {
            'timestamp': datetime.now().isoformat(),
            'total_attempts': total_attempts,
            'successful_attempts': successful_count,
            'win_rate': win_rate,
            'latency_stats': latency_stats,
            'provider_metrics': provider_metrics,
            'failure_reasons': failure_reasons,
            'scheduling_precision': {
                'median_delay_ms': statistics.median(scheduling_delays) if scheduling_delays else 0,
                'max_delay_ms': max(scheduling_delays) if scheduling_delays else 0,
                'avg_delay_ms': statistics.mean(scheduling_delays) if scheduling_delays else 0
            }
        }
    
    def _percentile(self, data: List[float], percentile: int) -> float:
        """Calculate percentile of a dataset"""
        if not data:
            return 0
        sorted_data = sorted(data)
        index = (percentile / 100) * (len(sorted_data) - 1)
        if index.is_integer():
            return sorted_data[int(index)]
        else:
            lower = sorted_data[int(index)]
            upper = sorted_data[int(index) + 1]
            return lower + (upper - lower) * (index - int(index))
    
    def generate_performance_report(self, results: Dict) -> str:
        """Generate human-readable performance report"""
        report = f"""
# Performance Evaluation Report
Generated: {results['timestamp']}

## Overall Performance
- **Win Rate:** {results['win_rate']:.1%} ({results['successful_attempts']}/{results['total_attempts']} successful)
- **Median Latency:** {results['latency_stats'].get('median_ms', 0):.0f}ms
- **95th Percentile:** {results['latency_stats'].get('p95_ms', 0):.0f}ms

## Scheduling Precision
- **Median Delay:** {results['scheduling_precision']['median_delay_ms']:.1f}ms
- **Max Delay:** {results['scheduling_precision']['max_delay_ms']:.1f}ms
- **Average Delay:** {results['scheduling_precision']['avg_delay_ms']:.1f}ms

## Provider Performance
"""
        
        for provider, metrics in results['provider_metrics'].items():
            status = "✅" if metrics['win_rate'] > 0.8 else "❌" if metrics['win_rate'] < 0.5 else "⚠️"
            report += f"- {status} **{provider.title()}:** {metrics['win_rate']:.1%} win rate, {metrics['avg_latency_ms']:.0f}ms avg latency\n"
        
        if results['failure_reasons']:
            report += "\n## Failure Analysis\n"
            for reason, count in sorted(results['failure_reasons'].items(), key=lambda x: x[1], reverse=True):
                report += f"- {reason}: {count} occurrences\n"
        
        return report

async def main():
    """Main evaluation entry point"""
    logging.basicConfig(level=logging.INFO)
    
    evaluator = PerformanceEvaluator()
    results = await evaluator.run_performance_evaluation(num_attempts=100)
    
    # Save results
    with open(f'performance_results_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    # Print report
    report = evaluator.generate_performance_report(results)
    print(report)
    
    # Exit with error code if performance is below threshold
    if results['win_rate'] < 0.85:
        print(f"❌ Win rate below threshold: {results['win_rate']:.1%} < 85%")
        exit(1)
    else:
        print(f"✅ Win rate meets threshold: {results['win_rate']:.1%} >= 85%")

if __name__ == "__main__":
    asyncio.run(main())